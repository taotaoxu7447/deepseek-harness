/**
 * Drop intake helpers for the composer: the browser folder-drop traversal
 * (the `webkitGetAsEntry` tree walk that collects attachable images, since a
 * dropped folder's pseudo-File is an empty husk and `dataTransfer.files`
 * never descends), and the native shell's drop payload decoding (the macOS
 * overlay owns Finder drags there and delivers absolute paths plus image
 * bytes over `window.__dshNativeDrop`).
 */

/** Browser FileSystemEntry faces used by `webkitGetAsEntry` — not in lib.dom. */
interface FileSystemEntryLike {
  readonly isFile: boolean
  readonly isDirectory: boolean
}

/** The file-leaf face of {@link FileSystemEntryLike}. */
interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (success: (file: File) => void, error?: (error: unknown) => void) => void
}

/** The directory-node face of {@link FileSystemEntryLike}. */
interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => {
    readEntries: (success: (entries: readonly FileSystemEntryLike[]) => void, error?: (error: unknown) => void) => void
  }
}

/** DataTransferItem with the (unprefixed-in-every-browser) entry accessor. */
interface DataTransferItemWithEntry {
  webkitGetAsEntry?: () => FileSystemEntryLike | null
}

/**
 * The macOS shell's drop payload: folders and non-image files as absolute
 * paths for `@` mentions, image files as base64 bytes for the image draft
 * flow. Both arrays may be absent.
 */
export interface NativeDropPayload {
  mentions?: readonly { path: string; directory: boolean }[]
  images?: readonly { name: string; type: string; data: string }[]
}

declare global {
  interface Window {
    /** Mounted by the composer while it can accept a native-shell drop. */
    __dshNativeDrop?: (payload: NativeDropPayload) => void
  }
}

/** Upper bound on one browser folder traversal (node_modules-shaped trees). */
const BROWSER_WALK_MAX_ENTRIES = 512

/**
 * The entry a dropped item carries, when the platform exposes the API.
 * @param item - one `dataTransfer.items` member.
 * @returns the entry, or `null` outside directory-aware drops.
 */
export function droppedEntryOf(item: DataTransferItem): FileSystemEntryLike | null {
  return (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null
}

/**
 * Whether a drop carries at least one folder.
 * @param entries - the drop's top-level entries.
 * @returns true when any entry is a directory.
 */
export function hasDroppedDirectory(entries: readonly (FileSystemEntryLike | null)[]): boolean {
  return entries.some(entry => entry?.isDirectory === true)
}

async function collectInto(entry: FileSystemEntryLike, budget: { left: number }, out: File[]): Promise<void> {
  if (budget.left <= 0) return
  if (entry.isFile) {
    budget.left -= 1
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntryLike).file(resolve, () => { resolve(null) })
    })
    if (file !== null && file.type.startsWith('image/')) out.push(file)
    return
  }
  if (!entry.isDirectory) return
  budget.left -= 1
  const reader = (entry as FileSystemDirectoryEntryLike).createReader()
  // readEntries pages (≤100 per call in Chromium): read until an empty page.
  for (;;) {
    const page = await new Promise<readonly FileSystemEntryLike[]>((resolve) => {
      reader.readEntries(resolve, () => { resolve([]) })
    })
    if (page.length === 0) return
    for (const child of page) await collectInto(child, budget, out)
  }
}

/**
 * Collect the attachable images inside a browser folder drop, descending
 * into directories. Order follows the entry tree; the walk stops after
 * {@link BROWSER_WALK_MAX_ENTRIES} visited entries.
 * @param entries - the drop's top-level entries.
 * @returns the image files found, possibly empty.
 */
export async function droppedEntryImages(entries: readonly FileSystemEntryLike[]): Promise<File[]> {
  const budget = { left: BROWSER_WALK_MAX_ENTRIES }
  const out: File[] = []
  await Promise.all(entries.map(entry => collectInto(entry, budget, out)))
  return out
}

/**
 * Rebuild one image File from the native shell's bridge entry.
 * @param name - the dropped file's name.
 * @param type - its MIME type as the shell classified it.
 * @param data - base64 bytes.
 * @returns a browser File the image draft flow accepts.
 */
export function imageFileFromBridge(name: string, type: string, data: string): File {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], name, { type })
}
