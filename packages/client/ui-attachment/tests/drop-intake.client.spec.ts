// @vitest-environment jsdom
// Drop-intake helpers: the webkitGetAsEntry tree walk for browser folder
// drops (paging, budget, error leaves) and the native bridge payload decode.

import { describe, expect, it } from 'vitest'
import {
  droppedEntryImages, droppedEntryOf, hasDroppedDirectory, imageFileFromBridge,
} from '../src/client/drop-intake.ts'

interface EntrySpec {
  name: string
  file?: File
  fileError?: boolean
  children?: EntrySpec[][]
  readError?: boolean
}

/** Build one fake FileSystemEntry: a file leaf, or a directory with paged children. */
function entryOf(spec: EntrySpec) {
  const isFile = spec.children === undefined
  return {
    isFile,
    isDirectory: !isFile,
    name: spec.name,
    ...(isFile
      ? {
        file: (ok: (file: File) => void, fail?: (error: unknown) => void) => {
          if (spec.fileError === true) fail?.(new Error('denied'))
          else if (spec.file !== undefined) ok(spec.file)
        },
      }
      : {
        createReader: () => {
          const pages = (spec.children ?? []).map(page => page.map(entryOf))
          return {
            readEntries: (ok: (entries: unknown[]) => void, fail?: (error: unknown) => void) => {
              if (spec.readError === true) { fail?.(new Error('denied')); return }
              ok(pages.shift() ?? [])
            },
          }
        },
      }),
  }
}

const png = (name: string) => new File([Uint8Array.of(1)], name, { type: 'image/png' })

describe('droppedEntryOf', () => {
  it('reads the entry when the platform exposes the accessor', () => {
    const entry = entryOf({ name: 'x', file: png('x.png') })
    expect(droppedEntryOf({
      webkitGetAsEntry: () => entry,
    } as unknown as DataTransferItem)).toBe(entry)
    expect(droppedEntryOf({
      webkitGetAsEntry: () => null,
    } as unknown as DataTransferItem)).toBeNull()
    expect(droppedEntryOf({} as unknown as DataTransferItem)).toBeNull()
  })
})

describe('hasDroppedDirectory', () => {
  it('answers whether any entry is a directory', () => {
    const dir = entryOf({ name: 'dir', children: [] })
    const file = entryOf({ name: 'x', file: png('x.png') })
    expect(hasDroppedDirectory([file, dir])).toBe(true)
    expect(hasDroppedDirectory([file, null])).toBe(false)
  })
})

describe('droppedEntryImages', () => {
  it('collects images across paged directories and skips non-images and failed leaves', async () => {
    const tree = entryOf({
      name: 'shots',
      children: [
        [
          { name: 'a', file: png('a.png') },
          { name: 'notes', file: new File([Uint8Array.of(1)], 'n.txt', { type: 'text/plain' }) },
          { name: 'denied', fileError: true },
        ],
        [
          {
            name: 'nested',
            children: [[{ name: 'b', file: png('b.png') }]],
          },
        ],
        [],
      ],
    })
    const images = await droppedEntryImages([tree])
    expect(images.map(image => image.name)).toEqual(['a.png', 'b.png'])
  })

  it('treats a readEntries failure as an empty page and unknown kinds as nothing', async () => {
    const denied = entryOf({ name: 'dir', children: [], readError: true })
    const neither = { isFile: false, isDirectory: false, name: 'mystery' }
    const images = await droppedEntryImages([denied, neither])
    expect(images).toEqual([])
  })

  it('stops walking once the entry budget is spent', async () => {
    const many = entryOf({
      name: 'root',
      children: [Array.from({ length: 4 }, (_, index) => ({
        name: `f${String(index)}`,
        file: png(`f${String(index)}.png`),
      }))],
    })
    // Budget: root + two leaves — the remaining leaves go unvisited.
    const images = await droppedEntryImages(Array.from({ length: 200 }, () => many))
    expect(images.length).toBeLessThan(200 * 4)
  })
})

describe('imageFileFromBridge', () => {
  it('rebuilds the file with its bytes, name, and MIME type', async () => {
    const data = btoa('pixel-bytes')
    const file = imageFileFromBridge('shot.png', 'image/png', data)
    expect(file.name).toBe('shot.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe('pixel-bytes'.length)
    await expect(file.text()).resolves.toBe('pixel-bytes')
  })
})
