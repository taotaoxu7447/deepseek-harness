// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function props(overrides: Partial<ComposerAttachmentsOwnerProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddImages: () => {},
    onAddPaths: () => {},
    onRemoveImage: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    const image = attachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveImage = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveImage })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })

  it('answers native-shell drops: image bytes become drafts, paths become mentions', () => {
    const onAddImages = vi.fn()
    const onAddPaths = vi.fn()
    render(<ComposerAttachments {...props({ onAddImages, onAddPaths })} />)

    act(() => {
      window.__dshNativeDrop?.({
        mentions: [{ path: '/Users/me/code/folder', directory: true }],
        images: [{ name: 'shot.png', type: 'image/png', data: btoa('px') }],
      })
    })
    expect(onAddPaths).toHaveBeenCalledWith([{ path: '/Users/me/code/folder', directory: true }])
    expect(onAddImages).toHaveBeenCalledTimes(1)
    const files = onAddImages.mock.calls[0]![0] as File[]
    expect(files[0]!.name).toBe('shot.png')
    expect(files[0]!.type).toBe('image/png')

    // Sparse payload: no images key at all, empty mentions.
    act(() => { window.__dshNativeDrop?.({ mentions: [] }) })
    expect(onAddImages).toHaveBeenCalledTimes(1)
    expect(onAddPaths).toHaveBeenCalledTimes(1)
  })

  it('holds native image bytes back while the composer refuses drops', () => {
    const onAddImages = vi.fn()
    render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    act(() => {
      window.__dshNativeDrop?.({ images: [{ name: 'x.png', type: 'image/png', data: btoa('px') }] })
    })
    expect(onAddImages).not.toHaveBeenCalled()
  })

  it('an unmounted receiver never eats a drop meant for its successor', () => {
    const first = render(<ComposerAttachments {...props()} />)
    const second = render(<ComposerAttachments {...props()} />)
    const successor = window.__dshNativeDrop
    first.unmount()
    expect(window.__dshNativeDrop).toBe(successor)
    second.unmount()
    expect(window.__dshNativeDrop).toBeUndefined()
  })

  it('attaches the images inside a browser folder drop instead of its empty husk', async () => {
    const onAddImages = vi.fn()
    render(<ComposerAttachments {...props({ onAddImages })} />)
    const inner = new File([Uint8Array.of(1)], 'inner.png', { type: 'image/png' })
    let paged = false
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (ok: (entries: unknown[]) => void) => {
          // readEntries pages: one entry, then the empty page that ends the walk.
          if (paged) { ok([]); return }
          paged = true
          ok([{
            isFile: true,
            isDirectory: false,
            file: (done: (file: File) => void) => { done(inner) },
          }])
        },
      }),
    }
    const dataTransfer = {
      types: ['Files'],
      files: [new File([], 'folder', { type: '' })],
      items: [{ webkitGetAsEntry: () => directoryEntry }],
      dropEffect: 'none',
    }
    fireEvent.drop(document.body, { dataTransfer })
    await vi.waitFor(() => { expect(onAddImages).toHaveBeenCalledWith([inner]) })
  })

  it('folder drops without attachable images add nothing', async () => {
    const onAddImages = vi.fn()
    render(<ComposerAttachments {...props({ onAddImages })} />)
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (ok: (entries: unknown[]) => void) => { ok([]) },
      }),
    }
    fireEvent.drop(document.body, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [{ webkitGetAsEntry: () => directoryEntry }],
        dropEffect: 'none',
      },
    })
    await Promise.resolve()
    expect(onAddImages).not.toHaveBeenCalled()
  })

  it('a blocked composer ignores a browser folder drop', () => {
    const onAddImages = vi.fn()
    render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    const directoryEntry = { isFile: false, isDirectory: true, createReader: () => ({}) }
    fireEvent.drop(document.body, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [{ webkitGetAsEntry: () => directoryEntry }],
        dropEffect: 'none',
      },
    })
    expect(onAddImages).not.toHaveBeenCalled()
  })
})
