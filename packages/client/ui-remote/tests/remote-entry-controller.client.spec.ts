// @vitest-environment jsdom

/** The remote entry controller: pure helpers plus the poll/verb/add flows. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  deviceLabel, mintDeviceId, REMOTE_ENTRY_POLL_MS, RemoteEntryController,
  type RemoteEntryDevice, type RemoteSettings,
} from '../src/client/remote-entry-controller.ts'

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

const CONNECTING_PLAIN: RemoteEntryDevice = {
  id: 'plain',
  sshTarget: 'plainhost',
  remotePort: 3080,
  localPort: 13390,
  autoConnect: false,
  tunnel: 'connecting',
}

const READY_QUERY: RemoteEntryDevice = {
  id: 'query',
  sshTarget: 'queryhost',
  remotePort: 3080,
  localPort: 13391,
  autoConnect: false,
  tunnel: 'ready',
  url: 'http://127.0.0.1:13391/?x=1',
}

/** A list answer over the wire view the Host's remote domain returns. */
function listAnswer(devices: RemoteEntryDevice[]) {
  return { rpcId: 'r' as never, result: { ok: true as const, value: { devices } } }
}

function makeApi(devices: RemoteEntryDevice[] = []) {
  return {
    remote: {
      list: vi.fn(() => Promise.resolve(listAnswer(devices))),
      connect: vi.fn(() => Promise.resolve({
        rpcId: 'c' as never, result: { ok: true as const, value: { device: READY_MAC } },
      })),
      disconnect: vi.fn(() => Promise.resolve({
        rpcId: 'd' as never, result: { ok: true as const, value: { device: READY_MAC } },
      })),
    },
  }
}

function makeScope(stored: RemoteSettings = {}) {
  const set = vi.fn((_field: string, _value: unknown) => Promise.resolve())
  const scope: SettingsScope<RemoteSettings> = {
    getSnapshot: () => ({
      status: 'ready',
      value: stored,
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set,
    unset: vi.fn(() => Promise.resolve()),
  }
  return { scope, set }
}

/** Flush the microtask chain a resolved-promise poll walks. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('deviceLabel', () => {
  it('prefers the configured label and falls back to the id', () => {
    expect(deviceLabel({ id: 'a', label: 'Home' })).toBe('Home')
    expect(deviceLabel({ id: 'a' })).toBe('a')
    expect(deviceLabel({ id: 'a', label: '' })).toBe('a')
  })
})

describe('mintDeviceId', () => {
  it('slugs the label when free', () => {
    expect(mintDeviceId('Home Mac Mini', new Set())).toBe('home-mac-mini')
  })

  it('counts past collisions and blank slugs', () => {
    expect(mintDeviceId('mac', new Set(['mac']))).toBe('device-2')
    expect(mintDeviceId('！！', new Set())).toBe('device-1')
    expect(mintDeviceId('', new Set(['device-1']))).toBe('device-2')
    // A taken device-N id chains the counter forward.
    expect(mintDeviceId('a', new Set(['a', 'device-3']))).toBe('device-4')
  })
})

describe('RemoteEntryController', () => {
  it('bootstraps one poll so a Host-auto-connected tunnel shows on the trigger', async () => {
    const withDetail: RemoteEntryDevice = { ...READY_MAC, id: 'noted', detail: 'tunnel via macmini' }
    const api = makeApi([READY_MAC, withDetail])
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    await flush()

    const state = controller.inject().hooks.remoteEntry.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.devices).toEqual([READY_MAC, withDetail])
    expect(api.remote.list).toHaveBeenCalledTimes(1)
  })

  it('stays unavailable when the remote domain cannot answer', async () => {
    const api = makeApi()
    api.remote.list.mockRejectedValue(new Error('no remote'))
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    await flush()

    expect(controller.inject().hooks.remoteEntry.getSnapshot().available).toBe(false)
  })

  it('polls only while the modal is open, and dispose stops the timer', async () => {
    const api = makeApi([READY_MAC])
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()
    expect(api.remote.list).toHaveBeenCalledTimes(1)

    face.setOpen(true)
    await flush()
    expect(api.remote.list).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(REMOTE_ENTRY_POLL_MS)
    expect(api.remote.list).toHaveBeenCalledTimes(3)
    expect(face.hooks.remoteEntry.getSnapshot().open).toBe(true)

    // A no-op setOpen keeps the current poll cadence.
    face.setOpen(true)
    face.setOpen(false)
    expect(face.hooks.remoteEntry.getSnapshot().open).toBe(false)
    await vi.advanceTimersByTimeAsync(REMOTE_ENTRY_POLL_MS * 3)
    expect(api.remote.list).toHaveBeenCalledTimes(3)

    face.setOpen(true)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(REMOTE_ENTRY_POLL_MS * 3)
    expect(api.remote.list).toHaveBeenCalledTimes(4)
  })

  it('folds an overlapping poll request into one follow-up', async () => {
    const api = makeApi([READY_MAC])
    let release: (() => void) | undefined
    api.remote.list.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => { resolve(listAnswer([READY_MAC])) }
    }))
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    // The bootstrap poll is now in flight; a second request queues.
    face.setOpen(true)
    release?.()
    await flush()
    expect(api.remote.list).toHaveBeenCalledTimes(2)
    expect(face.hooks.remoteEntry.getSnapshot().devices).toEqual([READY_MAC])
  })

  it('runs the connect and disconnect verbs with busy tracking', async () => {
    const api = makeApi([{ ...READY_MAC, tunnel: 'disconnected' as const }])
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.connect('mac-mini')
    expect(face.hooks.remoteEntry.getSnapshot().busy).toEqual(['mac-mini'])
    await flush()
    expect(api.remote.connect).toHaveBeenCalledWith({ id: 'mac-mini' })
    expect(face.hooks.remoteEntry.getSnapshot().busy).toEqual([])

    face.disconnect('mac-mini')
    await flush()
    expect(api.remote.disconnect).toHaveBeenCalledWith({ id: 'mac-mini' })
  })

  it('survives a rejected verb call and still repolls', async () => {
    const api = makeApi([READY_MAC])
    api.remote.connect.mockRejectedValue(new Error('boom'))
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.connect('mac-mini')
    await flush()
    expect(face.hooks.remoteEntry.getSnapshot().busy).toEqual([])
  })

  it('stages a ready device as a window tab and ignores one without a URL', async () => {
    const openRemoteTab = vi.fn()
    const api = makeApi([READY_MAC, CONNECTING_PLAIN])
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab })
    const face = controller.inject()
    await flush()

    face.openHere('mac-mini')
    expect(openRemoteTab).toHaveBeenCalledWith({ id: 'mac-mini', label: 'Mac Mini', url: 'http://127.0.0.1:13389/' })

    face.openHere('plain')
    face.openHere('missing')
    expect(openRemoteTab).toHaveBeenCalledTimes(1)
  })

  it('opens externally with the device label riding the URL', async () => {
    const opened: string[] = []
    const api = makeApi([READY_MAC, READY_QUERY, CONNECTING_PLAIN])
    const controller = new RemoteEntryController(
      makeScope().scope, api, { openRemoteTab: vi.fn() },
      { open: (url) => { opened.push(url) } },
    )
    const face = controller.inject()
    await flush()

    face.openExternal('mac-mini')
    expect(opened).toEqual(['http://127.0.0.1:13389/?dshRemoteLabel=Mac%20Mini'])

    face.openExternal('query')
    expect(opened[1]).toBe('http://127.0.0.1:13391/?x=1&dshRemoteLabel=query')

    face.openExternal('plain')
    face.openExternal('missing')
    expect(opened).toHaveLength(2)
  })

  it('uses window.open as the default navigation', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const api = makeApi([READY_MAC])
    const controller = new RemoteEntryController(makeScope().scope, api, { openRemoteTab: vi.fn() })
    await flush()

    controller.inject().openExternal('mac-mini')
    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:13389/?dshRemoteLabel=Mac%20Mini', '_blank', 'noopener',
    )
    open.mockRestore()
  })

  it('rejects a blank SSH target without touching the scope', async () => {
    const scope = makeScope()
    const controller = new RemoteEntryController(scope.scope, makeApi(), { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: 'x', sshTarget: '  ', remotePort: '', localPort: '', autoConnect: false })
    await flush()
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBe('add.targetRequired')
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('rejects an unparseable port without touching the scope', async () => {
    const scope = makeScope()
    const controller = new RemoteEntryController(scope.scope, makeApi(), { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: 'x', sshTarget: 'mac', remotePort: 'abc', localPort: '', autoConnect: false })
    await flush()
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBe('add.failed')
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('extends the stored roster, connects an auto-connect device, and folds the form', async () => {
    const scope = makeScope({ devices: [{ id: 'old', sshTarget: 'elsewhere' }] })
    const api = makeApi([READY_MAC])
    const controller = new RemoteEntryController(scope.scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()
    face.setAddOpen(true)

    face.addDevice({
      label: 'Work Box', sshTarget: 'workbox', remotePort: '3080', localPort: '14000', autoConnect: true,
    })
    await flush()
    expect(scope.set).toHaveBeenCalledWith('devices', [
      { id: 'old', sshTarget: 'elsewhere' },
      { id: 'work-box', label: 'Work Box', sshTarget: 'workbox', remotePort: 3080, localPort: 14000, autoConnect: true },
    ])
    expect(api.remote.connect).toHaveBeenCalledWith({ id: 'work-box' })
    expect(face.hooks.remoteEntry.getSnapshot().addOpen).toBe(false)
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBeUndefined()
  })

  it('omits blank optional fields and skips the connect without autoConnect', async () => {
    const scope = makeScope()
    const api = makeApi([])
    const controller = new RemoteEntryController(scope.scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: '', sshTarget: 'plain', remotePort: '', localPort: '', autoConnect: false })
    await flush()
    expect(scope.set).toHaveBeenCalledWith('devices', [{ id: 'device-1', sshTarget: 'plain' }])
    expect(api.remote.connect).not.toHaveBeenCalled()
  })

  it('keeps a saved device whose auto-connect call fails', async () => {
    const scope = makeScope()
    const api = makeApi([])
    api.remote.connect.mockRejectedValue(new Error('ssh down'))
    const controller = new RemoteEntryController(scope.scope, api, { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: '', sshTarget: 'mac', remotePort: '', localPort: '', autoConnect: true })
    await flush()
    expect(scope.set).toHaveBeenCalledWith('devices', [{ id: 'device-1', sshTarget: 'mac', autoConnect: true }])
    const state = face.hooks.remoteEntry.getSnapshot()
    expect(state.failure).toBeUndefined()
    expect(state.addOpen).toBe(false)
  })

  it('reports a failed roster write', async () => {
    const scope = makeScope()
    scope.set.mockRejectedValue(new Error('read-only'))
    const controller = new RemoteEntryController(scope.scope, makeApi(), { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: 'x', sshTarget: 'mac', remotePort: '', localPort: '', autoConnect: false })
    await flush()
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBe('add.failed')
    expect(face.hooks.remoteEntry.getSnapshot().busy).toEqual([])
  })

  it('clears a stale failure when the add form is folded or unfolded', async () => {
    const controller = new RemoteEntryController(makeScope().scope, makeApi(), { openRemoteTab: vi.fn() })
    const face = controller.inject()
    await flush()

    face.addDevice({ label: 'x', sshTarget: '', remotePort: '', localPort: '', autoConnect: false })
    await flush()
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBe('add.targetRequired')

    face.setAddOpen(true)
    expect(face.hooks.remoteEntry.getSnapshot().failure).toBeUndefined()
  })
})
