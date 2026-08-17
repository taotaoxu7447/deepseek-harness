/**
 * Header-only image dimension probing for the input-token estimate. The
 * declared media type picks the parser; a parser that cannot read its header
 * returns `undefined` and the estimate falls back to a byte count, so a
 * malformed or exotic image degrades the estimate rather than the describe.
 * @module @deepseek-ai/dsh-vision-qwen/image-size
 */

/** Pixel dimensions of one image. */
export interface ImagePixels {
  /** Image width in pixels. */
  readonly width: number
  /** Image height in pixels. */
  readonly height: number
}

/**
 * Read the pixel dimensions of an encoded image without decoding it.
 * @param bytes - the encoded image.
 * @param mediaType - the declared media type, selecting the header format.
 * @returns the dimensions, or `undefined` when the header is unreadable.
 */
export function probeImagePixels(bytes: Uint8Array, mediaType: string): ImagePixels | undefined {
  switch (mediaType) {
    case 'image/png': return pngPixels(bytes)
    case 'image/jpeg': return jpegPixels(bytes)
    case 'image/gif': return gifPixels(bytes)
    case 'image/webp': return webpPixels(bytes)
    default: return undefined
  }
}

/** Byte at `offset`, or -1 past the end: -1 fails a signature compare, and length checks run before dimension math. */
function byteAt(bytes: Uint8Array, offset: number): number {
  /* v8 ignore next -- every caller bounds-checks before reading; the fallback only satisfies noUncheckedIndexedAccess */
  return bytes[offset] ?? -1
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let index = offset; index < offset + length; index += 1) out += String.fromCharCode(byteAt(bytes, index))
  return out
}

function be32(bytes: Uint8Array, offset: number): number {
  const high = (byteAt(bytes, offset) << 24) | (byteAt(bytes, offset + 1) << 16)
  const low = (byteAt(bytes, offset + 2) << 8) | byteAt(bytes, offset + 3)
  return (high | low) >>> 0
}

const PNG_MAGIC: readonly number[] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

function pngPixels(bytes: Uint8Array): ImagePixels | undefined {
  if (bytes.length < 24 || !PNG_MAGIC.every((byte, index) => byteAt(bytes, index) === byte)) return undefined
  const width = be32(bytes, 16)
  const height = be32(bytes, 20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

function gifPixels(bytes: Uint8Array): ImagePixels | undefined {
  if (bytes.length < 10 || ascii(bytes, 0, 4) !== 'GIF8') return undefined
  const width = byteAt(bytes, 6) | (byteAt(bytes, 7) << 8)
  const height = byteAt(bytes, 8) | (byteAt(bytes, 9) << 8)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** Start-of-frame markers: C0–CF minus DHT (C4), JPG (C8), and DAC (CC). */
function isJpegSof(marker: number): boolean {
  return marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
}

/** Standalone JPEG markers carry no length word. */
function isJpegStandalone(marker: number): boolean {
  return marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)
}

function jpegPixels(bytes: Uint8Array): ImagePixels | undefined {
  if (bytes.length < 4 || byteAt(bytes, 0) !== 0xFF || byteAt(bytes, 1) !== 0xD8) return undefined
  let offset = 2
  while (offset + 9 <= bytes.length) {
    if (byteAt(bytes, offset) !== 0xFF) return undefined
    const marker = byteAt(bytes, offset + 1)
    if (isJpegStandalone(marker)) {
      offset += 2
      continue
    }
    const length = (byteAt(bytes, offset + 2) << 8) | byteAt(bytes, offset + 3)
    if (length < 2) return undefined
    if (isJpegSof(marker)) {
      const height = (byteAt(bytes, offset + 5) << 8) | byteAt(bytes, offset + 6)
      const width = (byteAt(bytes, offset + 7) << 8) | byteAt(bytes, offset + 8)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    offset += 2 + length
  }
  return undefined
}

function webpPixels(bytes: Uint8Array): ImagePixels | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    const width = 1 + (byteAt(bytes, 24) | (byteAt(bytes, 25) << 8) | (byteAt(bytes, 26) << 16))
    const height = 1 + (byteAt(bytes, 27) | (byteAt(bytes, 28) << 8) | (byteAt(bytes, 29) << 16))
    return { width, height }
  }
  if (chunk === 'VP8 ') {
    if (byteAt(bytes, 23) !== 0x9D || byteAt(bytes, 24) !== 0x01 || byteAt(bytes, 25) !== 0x2A) return undefined
    const width = (byteAt(bytes, 26) | (byteAt(bytes, 27) << 8)) & 0x3FFF
    const height = (byteAt(bytes, 28) | (byteAt(bytes, 29) << 8)) & 0x3FFF
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (chunk === 'VP8L') {
    if (byteAt(bytes, 20) !== 0x2F) return undefined
    const width = 1 + (((byteAt(bytes, 22) & 0x3F) << 8) | byteAt(bytes, 21))
    const height = 1 + (((byteAt(bytes, 24) & 0x0F) << 10) | (byteAt(bytes, 23) << 2) | ((byteAt(bytes, 22) & 0xC0) >> 6))
    // The lossless bitstream stores dimensions minus one, so both are at least 1.
    return { width, height }
  }
  return undefined
}
