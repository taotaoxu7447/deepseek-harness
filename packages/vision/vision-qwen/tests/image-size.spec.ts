/** Header-only dimension probing: real minimal headers per format, plus the malformed inputs. */

import { describe, expect, it } from 'vitest'
import { probeImagePixels } from '@deepseek-ai/dsh-vision-qwen'

/** A PNG header for a width×height image (magic, IHDR length/type, dimensions). */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  bytes.set([0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52], 8)
  bytes.set([(width >>> 24) & 0xFF, (width >>> 16) & 0xFF, (width >>> 8) & 0xFF, width & 0xFF], 16)
  bytes.set([(height >>> 24) & 0xFF, (height >>> 16) & 0xFF, (height >>> 8) & 0xFF, height & 0xFF], 20)
  return bytes
}

/** A JPEG stream: SOI, the given segments, then nothing. */
function jpeg(...segments: number[][]): Uint8Array {
  return new Uint8Array([0xFF, 0xD8, ...segments.flat()])
}

/** A WebP container wrapping one chunk (RIFF size field included). */
function webp(chunk: number[]): Uint8Array {
  const body = [0x57, 0x45, 0x42, 0x50, ...chunk]
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, body.length & 0xFF, 0, 0, 0, ...body])
}

describe('probeImagePixels', () => {
  it('reads PNG dimensions from the IHDR', () => {
    expect(probeImagePixels(png(1920, 1080), 'image/png')).toEqual({ width: 1920, height: 1080 })
  })

  it('refuses a truncated or wrongly-signed PNG', () => {
    expect(probeImagePixels(png(1, 1).slice(0, 12), 'image/png')).toBeUndefined()
    expect(probeImagePixels(new Uint8Array(24), 'image/png')).toBeUndefined()
    // A zero dimension is not an image.
    expect(probeImagePixels(png(0, 1080), 'image/png')).toBeUndefined()
  })

  it('reads GIF dimensions little-endian', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x02, 0x40, 0x01])
    expect(probeImagePixels(gif, 'image/gif')).toEqual({ width: 640, height: 320 })
    expect(probeImagePixels(gif.slice(0, 6), 'image/gif')).toBeUndefined()
    expect(probeImagePixels(new Uint8Array(10), 'image/gif')).toBeUndefined()
    // A zero height is not an image.
    const flat = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x02, 0, 0])
    expect(probeImagePixels(flat, 'image/gif')).toBeUndefined()
  })

  it('reads JPEG dimensions from the first start-of-frame segment', () => {
    const image = jpeg(
      // APP0: length 16, 14 payload bytes.
      [0xFF, 0xE0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)],
      // A restart marker between segments carries no length.
      [0xFF, 0xD0],
      // SOF0: length 17, precision 8, height 480, width 800.
      [0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0xE0, 0x03, 0x20, 0, 0, 0],
    )
    expect(probeImagePixels(image, 'image/jpeg')).toEqual({ width: 800, height: 480 })
  })

  it('refuses JPEG streams without a readable frame', () => {
    expect(probeImagePixels(new Uint8Array([0x89, 0x50]), 'image/jpeg')).toBeUndefined()
    // A non-marker byte where a marker must stand.
    expect(probeImagePixels(jpeg([0x00, 0xE0, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeUndefined()
    // A corrupt length word.
    expect(probeImagePixels(jpeg([0xFF, 0xE0, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeUndefined()
    // Truncated before any SOF.
    expect(probeImagePixels(jpeg([0xFF, 0xE0, 0x00, 0x10]), 'image/jpeg')).toBeUndefined()
    // A start-of-frame with a zero height is not an image.
    expect(probeImagePixels(jpeg([0xFF, 0xC0, 0x00, 0x11, 0x08, 0, 0, 0x03, 0x20, 0, 0, 0]), 'image/jpeg')).toBeUndefined()
  })

  it('reads the three WebP chunk forms', () => {
    // VP8X: flags(4), then 24-bit minus-one width and height.
    const extended = webp([0x56, 0x50, 0x38, 0x58, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0x7F, 0x01, 0x00, 0x3F, 0x00, 0x00])
    expect(probeImagePixels(extended, 'image/webp')).toEqual({ width: 384, height: 64 })

    // VP8 (lossy): frame tag(3), start code 9D 01 2A, then 14-bit dimensions.
    const lossy = webp([0x56, 0x50, 0x38, 0x20, 0x0A, 0, 0, 0, 0, 0, 0, 0x9D, 0x01, 0x2A, 0x40, 0x01, 0xF0, 0x00])
    expect(probeImagePixels(lossy, 'image/webp')).toEqual({ width: 320, height: 240 })

    // VP8L (lossless): 0x2F signature, then packed 14-bit minus-one fields.
    const b0 = 0xFF; const b1 = 0x01; const b2 = 0x00; const b3 = 0x00
    const lossless = webp([0x56, 0x50, 0x38, 0x4C, 0x09, 0, 0, 0, 0x2F, b0, b1, b2, b3, 0, 0, 0, 0, 0])
    // width = 1 + (((b1 & 0x3F) << 8) | b0) = 1 + 0x1FF = 512; height = 1 + 0 = 1.
    expect(probeImagePixels(lossless, 'image/webp')).toEqual({ width: 512, height: 1 })
  })

  it('refuses unreadable WebP containers', () => {
    expect(probeImagePixels(new Uint8Array(40), 'image/webp')).toBeUndefined()
    // A lossy frame without the 9D 01 2A start code.
    const noStartCode = webp([0x56, 0x50, 0x38, 0x20, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x01, 0xF0, 0x00])
    expect(probeImagePixels(noStartCode, 'image/webp')).toBeUndefined()
    // A lossless frame without the 0x2F signature.
    const noSignature = webp([0x56, 0x50, 0x38, 0x4C, 0x09, 0, 0, 0, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(probeImagePixels(noSignature, 'image/webp')).toBeUndefined()
    // An unknown chunk fourcc.
    const unknown = webp([0x41, 0x4C, 0x50, 0x48, 0x09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(probeImagePixels(unknown, 'image/webp')).toBeUndefined()
    // Truncated before any chunk.
    expect(probeImagePixels(webp([0x56, 0x50]).slice(0, 14), 'image/webp')).toBeUndefined()
    // A lossy frame whose 14-bit dimensions read as zero.
    const zeroDims = webp([0x56, 0x50, 0x38, 0x20, 0x0A, 0, 0, 0, 0, 0, 0, 0x9D, 0x01, 0x2A, 0, 0, 0, 0])
    expect(probeImagePixels(zeroDims, 'image/webp')).toBeUndefined()
  })

  it('returns undefined for a media type with no header format', () => {
    expect(probeImagePixels(png(10, 10), 'image/svg+xml')).toBeUndefined()
  })
})
