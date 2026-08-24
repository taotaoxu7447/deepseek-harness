// @vitest-environment jsdom

/** The sidebar footer trigger and the remote-device modal rendering. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteEntry, type RemoteEntryProps } from '../src/client/RemoteEntry.tsx'
import { zh } from '../src/client/locales.ts'
import type {
  AddDeviceDraft, RemoteEntryDevice, RemoteEntryFace, RemoteEntryState,
} from '../src/client/remote-entry-controller.ts'

const t = makeTranslate(zh) as RemoteEntryProps['t']

const READY_MAC: RemoteEntryDevice = {
  id: 'mac-mini',
  label: 'Mac Mini',
  sshTarget: 'macmini',
  remotePort: 3080,
  localPort: 13389,
  autoConnect: true,
  tunnel: 'ready',
  url: 'http://127.0.0.1:13389/',
}

const FAILED_BOX: RemoteEntryDevice = {
  id: 'workbox',
  sshTarget: 'workbox',
  remotePort: 3080,
  localPort: 13390,
  autoConnect: false,
  tunnel: 'failed',
  detail: 'ssh exited 255',
}

function makeState(over: Partial<RemoteEntryState> = {}): RemoteEntryState {
  return {
    available: true,
    open: false,
    addOpen: false,
    devices: [],
    busy: [],
    ...over,
  }
}

interface Bench {
  props: RemoteEntryProps
  face: { [K in keyof Omit<RemoteEntryFace, 'hooks'>]: ReturnType<typeof vi.fn> }
}

function bench(state: RemoteEntryState, wide = true): Bench {
  const face = {
    setOpen: vi.fn(),
    setAddOpen: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    openHere: vi.fn(),
    openExternal: vi.fn(),
    addDevice: vi.fn(),
  }
  function useRemoteEntry<T>(select: (snapshot: RemoteEntryState) => T): T {
    return select(state)
  }
  const props = { wide, t, useRemoteEntry, ...face } as unknown as RemoteEntryProps
  return { props, face }
}

afterEach(cleanup)

describe('RemoteEntry trigger', () => {
  it('renders the wide row with its label and opens the modal on click', () => {
    const { props, face } = bench(makeState())
    render(<RemoteEntry {...props} />)

    const trigger = screen.getByRole('button', { name: zh['trigger.label'] })
    expect(trigger.textContent).toContain(zh['trigger.label'])
    fireEvent.click(trigger)
    expect(face.setOpen).toHaveBeenCalledWith(true)
  })

  it('collapses to a rail icon without the label', () => {
    const { props } = bench(makeState(), false)
    render(<RemoteEntry {...props} />)

    const trigger = screen.getByRole('button', { name: zh['trigger.label'] })
    expect(trigger.textContent).not.toContain(zh['trigger.label'])
  })

  it('summarizes the fleet on the trigger dot', () => {
    const cases: readonly [readonly RemoteEntryDevice[], string | null][] = [
      [[READY_MAC], 'done'],
      [[{ ...READY_MAC, tunnel: 'connecting' }], 'ongoing'],
      [[FAILED_BOX], 'error'],
      [[{ ...READY_MAC, tunnel: 'disconnected' }], null],
    ]
    for (const [devices, expected] of cases) {
      cleanup()
      const { props } = bench(makeState({ devices }))
      const { container } = render(<RemoteEntry {...props} />)
      const dot = container.querySelector('[data-state]')
      expect(dot?.getAttribute('data-state') ?? null).toBe(expected)
    }
  })
})

describe('RemoteEntry modal', () => {
  it('renders nothing of the dialog while closed', () => {
    const { props } = bench(makeState())
    render(<RemoteEntry {...props} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists each device with its phase pill and closes through the chrome', () => {
    const { props, face } = bench(makeState({ open: true, devices: [READY_MAC, FAILED_BOX] }))
    render(<RemoteEntry {...props} />)

    const dialog = screen.getByRole('dialog', { name: zh['modal.title'] })
    expect(dialog.textContent).toContain(zh['modal.description'])
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('Mac Mini')
    expect(rows[0]!.textContent).toContain(zh['state.ready'])
    expect(rows[1]!.textContent).toContain('workbox')
    expect(rows[1]!.textContent).toContain(zh['state.failed'])
    expect(rows[1]!.textContent).toContain('ssh exited 255')

    fireEvent.click(within(dialog).getByRole('button', { name: zh['modal.close'] }))
    expect(face.setOpen).toHaveBeenCalledWith(false)
  })

  it('closes on Escape through the modal chrome', () => {
    const { props, face } = bench(makeState({ open: true, devices: [READY_MAC] }))
    render(<RemoteEntry {...props} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(face.setOpen).toHaveBeenCalledWith(false)
  })

  it('offers the open gestures and disconnect on a ready row', () => {
    const { props, face } = bench(makeState({ open: true, devices: [READY_MAC] }))
    render(<RemoteEntry {...props} />)

    fireEvent.click(screen.getByRole('button', { name: zh['action.openTab'] }))
    expect(face.openHere).toHaveBeenCalledWith('mac-mini')
    fireEvent.click(screen.getByRole('button', { name: zh['action.openWindow'] }))
    expect(face.openExternal).toHaveBeenCalledWith('mac-mini')
    fireEvent.click(screen.getByRole('button', { name: zh['action.disconnect'] }))
    expect(face.disconnect).toHaveBeenCalledWith('mac-mini')
  })

  it('offers only connect on a disconnected row and disables a busy one', () => {
    const disconnected: RemoteEntryDevice = { ...READY_MAC, tunnel: 'disconnected' }
    const { props, face } = bench(makeState({ open: true, devices: [disconnected], busy: ['mac-mini'] }))
    const { unmount } = render(<RemoteEntry {...props} />)

    expect(screen.queryByRole('button', { name: zh['action.openTab'] })).toBeNull()
    const connect = screen.getByRole('button', { name: zh['action.connect'] }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.click(connect)
    expect(face.connect).not.toHaveBeenCalled()
    unmount()

    const idle = bench(makeState({ open: true, devices: [disconnected] }))
    render(<RemoteEntry {...idle.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.connect'] }))
    expect(idle.face.connect).toHaveBeenCalledWith('mac-mini')
  })

  it('hides the tunnel detail of a row that did not fail', () => {
    const noted: RemoteEntryDevice = { ...READY_MAC, detail: 'connected via ~/.ssh/config' }
    const { props } = bench(makeState({ open: true, devices: [noted] }))
    render(<RemoteEntry {...props} />)

    const row = within(screen.getByRole('dialog')).getByRole('listitem')
    expect(row.textContent).not.toContain('connected via')
  })

  it('reads the empty roster', () => {
    const { props } = bench(makeState({ open: true }))
    render(<RemoteEntry {...props} />)

    expect(screen.getByRole('dialog').textContent).toContain(zh['list.empty'])
  })

  it('unfolds the add form through its toggle', () => {
    const { props, face } = bench(makeState({ open: true }))
    render(<RemoteEntry {...props} />)

    fireEvent.click(screen.getByRole('button', { name: zh['add.toggle'] }))
    expect(face.setAddOpen).toHaveBeenCalledWith(true)
  })

  it('submits the staged draft and folds on cancel', () => {
    const { props, face } = bench(makeState({ open: true, addOpen: true }))
    render(<RemoteEntry {...props} />)

    fireEvent.change(screen.getByPlaceholderText(zh['add.label.placeholder']), { target: { value: 'Home Box' } })
    fireEvent.change(screen.getByPlaceholderText(zh['add.sshTarget.placeholder']), { target: { value: 'homebox' } })
    fireEvent.change(screen.getByPlaceholderText(zh['add.remotePort.placeholder']), { target: { value: '3080' } })
    fireEvent.change(screen.getByPlaceholderText(zh['add.localPort.placeholder']), { target: { value: '14000' } })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: zh['add.submit'] }))
    const draft: AddDeviceDraft = {
      label: 'Home Box', sshTarget: 'homebox', remotePort: '3080', localPort: '14000', autoConnect: false,
    }
    expect(face.addDevice).toHaveBeenCalledWith(draft)

    fireEvent.click(screen.getByRole('button', { name: zh['add.cancel'] }))
    expect(face.setAddOpen).toHaveBeenCalledWith(false)
  })

  it('surfaces an add failure inside the form', () => {
    const { props } = bench(makeState({ open: true, addOpen: true, failure: 'add.targetRequired' }))
    render(<RemoteEntry {...props} />)

    expect(screen.getByRole('alert').textContent).toContain(zh['add.targetRequired'])
  })
})
