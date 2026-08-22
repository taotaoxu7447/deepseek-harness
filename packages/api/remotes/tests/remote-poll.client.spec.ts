/** The shared remote-domain poll helpers: port parse, overlap fold, and the roster read. */

import { describe, expect, it, vi } from 'vitest'
import { createPollFold, listRemoteDevices, parseRemotePort, remoteTunnelFields } from '../src/client/remote-poll.ts'

describe('parseRemotePort', () => {
  it('parses a valid port and passes a blank draft through', () => {
    expect(parseRemotePort(' 3080 ')).toBe(3080)
    expect(parseRemotePort('')).toBeUndefined()
    expect(parseRemotePort('   ')).toBeUndefined()
  })

  it('rejects non-ports', () => {
    expect(() => parseRemotePort('abc')).toThrow('not a port: abc')
    expect(() => parseRemotePort('0')).toThrow()
    expect(() => parseRemotePort('65536')).toThrow()
    expect(() => parseRemotePort('30.5')).toThrow()
  })
})

describe('createPollFold', () => {
  it('runs a single request to completion', async () => {
    const run = vi.fn(() => Promise.resolve())
    const poll = createPollFold(run)
    await poll()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('folds an overlap into exactly one follow-up', async () => {
    let calls = 0
    let release: () => void = () => {}
    const run = vi.fn(() => {
      calls += 1
      // The follow-up run settles on its own; only the first needs releasing.
      if (calls > 1) return Promise.resolve()
      return new Promise<void>((resolve) => { release = resolve })
    })
    const poll = createPollFold(run)

    const first = poll()
    await poll()
    await poll()
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('remoteTunnelFields', () => {
  const base = {
    id: 'mac',
    sshTarget: 'mac',
    remotePort: 3080,
    localPort: 13389,
    autoConnect: false,
  }

  it('keeps the phase and omits absent detail and url', () => {
    expect(remoteTunnelFields({ ...base, tunnel: 'connecting' })).toEqual({ tunnel: 'connecting' })
  })

  it('carries the failure detail and the tunneled address when present', () => {
    expect(remoteTunnelFields({
      ...base, tunnel: 'failed', detail: 'ssh refused',
    })).toEqual({ tunnel: 'failed', detail: 'ssh refused' })
    expect(remoteTunnelFields({
      ...base, tunnel: 'ready', url: 'http://127.0.0.1:13389/',
    })).toEqual({ tunnel: 'ready', url: 'http://127.0.0.1:13389/' })
  })
})


describe('listRemoteDevices', () => {
  const device = {
    id: 'mac',
    sshTarget: 'mac',
    remotePort: 3080,
    localPort: 13389,
    autoConnect: false,
    tunnel: 'ready' as const,
    url: 'http://127.0.0.1:13389/',
  }

  it('returns the devices on a successful answer', async () => {
    const api = {
      remote: {
        list: vi.fn(() => Promise.resolve({
          rpcId: 'r' as never, result: { ok: true as const, value: { devices: [device] } },
        })),
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
    }
    await expect(listRemoteDevices(api)).resolves.toEqual([device])
  })

  it('returns undefined on a failed or unreachable answer', async () => {
    const failed = {
      remote: {
        list: vi.fn(() => Promise.resolve({
          rpcId: 'r' as never,
          result: { ok: false as const, error: { code: 'internal' as const, message: 'no', details: {} } },
        })),
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
    }
    await expect(listRemoteDevices(failed)).resolves.toBeUndefined()

    const down = {
      remote: {
        list: vi.fn(() => Promise.reject(new Error('down'))),
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
    }
    await expect(listRemoteDevices(down)).resolves.toBeUndefined()
  })
})
