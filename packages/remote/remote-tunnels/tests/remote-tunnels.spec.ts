/** The tunnel lifecycle state machine over a scripted subprocess seam. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import RemoteTunnels, {
  AUTO_LOCAL_PORT_BASE,
  classifyTunnelExit,
  RemoteTunnelError,
  resolveConfig,
  resolveDevices,
  validateRemoteConfig,
} from '@deepseek-ai/dsh-remote-tunnels'
import type { Config, RemoteDeviceView, RemoteTunnelPhase } from '@deepseek-ai/dsh-remote-tunnels'

/** A scripted child process: settle it from the test, or let `terminate` settle it. */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4321
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  terminated = false
  /** When true, termination never settles the process (a wedged tree). */
  wedged = false
  private stderrText = ''
  private settle!: (outcome: SubprocessOutcome) => void

  constructor(spawnError?: unknown, bare = false) {
    this.done = new Promise((resolve, reject) => {
      this.settle = resolve
      // Raw rejection on purpose: a real spawn failure can carry a non-Error.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      if (spawnError !== undefined) reject(spawnError)
    })
    // A bare capture stands in for a child whose stderr the seam never caught.
    this.collected = bare ? {} : {
      stderr: {
        readFrom: (fromByte: number) => ({
          text: this.stderrText.slice(fromByte),
          nextOffset: this.stderrText.length,
          lossy: false,
        }),
      },
    }
  }

  /** Settle `done` as an exited process carrying the given stderr tail. */
  exit(outcome: SubprocessOutcome, stderr = ''): void {
    this.stderrText = stderr
    this.settle(outcome)
  }

  terminate(): void {
    this.terminated = true
    if (!this.wedged) this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      void this.done.then(() => { resolve(true) })
      signal?.addEventListener('abort', () => { resolve(!this.wedged) }, { once: true })
    })
  }
}

/** A subprocess seam whose spawn answers from a scripted behavior queue. */
class FakeSubprocess extends SubprocessRuntime {
  /** Spawn behavior queue; empty means 'stay alive until terminated'. */
  spawnErrors: unknown[] = []
  handles: FakeHandle[] = []
  specs: SubprocessSpawnSpec[] = []
  sshAvailable = true
  /** When true, the next spawn produces a child with no captured stderr. */
  bareNext = false

  resolveExecutable(command: string): Promise<string> {
    if (command === 'ssh' && this.sshAvailable) return Promise.resolve('/usr/bin/ssh')
    return Promise.reject(new Error(`not found: ${command}`))
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const bare = this.bareNext
    this.bareNext = false
    const handle = new FakeHandle(this.spawnErrors.shift(), bare)
    this.handles.push(handle)
    return handle
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used by remote-tunnels'))
  }
}

/** Fast timing knobs so backoff and probing run in milliseconds. */
const FAST = {
  reconnectInitialMs: 50,
  reconnectMaxMs: 120,
  probeIntervalMs: 50,
  probeTimeoutMs: 100,
  terminateGraceMs: 100,
} satisfies Config

interface Bench {
  ctx: Context
  service: RemoteTunnels
  fake: FakeSubprocess
}

async function boot(config: Partial<Config>): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess).await()
  const fake = ctx.subprocess as unknown as FakeSubprocess
  await ctx.plugin(RemoteTunnels, { ...FAST, ...config }).await()
  return { ctx, service: ctx.remoteTunnels, fake }
}

/** Poll the roster until one device reaches a phase. */
async function until(service: RemoteTunnels, id: string, phase: RemoteTunnelPhase): Promise<RemoteDeviceView> {
  const deadline = Date.now() + 3000
  for (;;) {
    const view = service.list().find(row => row.id === id)
    if (view !== undefined && view.tunnel === phase) return view
    if (Date.now() > deadline) {
      throw new Error(`device "${id}" never reached "${phase}" (now ${view?.tunnel ?? 'absent'}: ${view?.detail ?? '-'})`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Poll the roster until one device's detail line matches. */
async function untilDetail(service: RemoteTunnels, id: string, pattern: RegExp): Promise<RemoteDeviceView> {
  const deadline = Date.now() + 3000
  for (;;) {
    const view = service.list().find(row => row.id === id)
    if (view?.detail !== undefined && pattern.test(view.detail)) return view
    if (Date.now() > deadline) {
      throw new Error(`device "${id}" detail never matched ${String(pattern)} (now ${view?.detail ?? '-'})`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** A fetch failure shaped like undici's connection refusal. */
function refusedError(): TypeError {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateRemoteConfig', () => {
  it('rejects empty ids, duplicate ids, empty targets, duplicate ports, and an inverted backoff', () => {
    expect(() => { validateRemoteConfig({ devices: [{ id: '  ', sshTarget: 'x' }] }) }).toThrow(/id must not be empty/)
    expect(() => {
      validateRemoteConfig({
        devices: [{ id: 'a', sshTarget: 'x' }, { id: 'a', sshTarget: 'y' }],
      })
    }).toThrow(/duplicate id/)
    expect(() => { validateRemoteConfig({ devices: [{ id: 'a', sshTarget: ' ' }] }) }).toThrow(/sshTarget must not be empty/)
    expect(() => {
      validateRemoteConfig({
        devices: [{ id: 'a', sshTarget: 'x', localPort: 14000 }, { id: 'b', sshTarget: 'y', localPort: 14000 }],
      })
    }).toThrow(/localPort 14000 is assigned to another device/)
    expect(() => {
      validateRemoteConfig({ reconnectInitialMs: 500, reconnectMaxMs: 100 })
    }).toThrow(/reconnectMaxMs 100 is below reconnectInitialMs 500/)
    expect(() => { validateRemoteConfig({ devices: [{ id: 'a', sshTarget: 'x' }] }) }).not.toThrow()
  })
})

describe('resolveDevices', () => {
  it('materializes defaults and hands auto ports around explicit claims', () => {
    const devices = resolveDevices({
      devices: [
        { id: 'pinned', sshTarget: 'a', localPort: AUTO_LOCAL_PORT_BASE + 1, label: 'Pinned' },
        { id: 'first', sshTarget: 'b' },
        { id: 'second', sshTarget: 'c', remotePort: 4000, autoConnect: true },
      ],
    })
    expect(devices).toEqual([
      { id: 'pinned', label: 'Pinned', sshTarget: 'a', remotePort: 3080, localPort: AUTO_LOCAL_PORT_BASE + 1, autoConnect: false },
      { id: 'first', sshTarget: 'b', remotePort: 3080, localPort: AUTO_LOCAL_PORT_BASE, autoConnect: false },
      { id: 'second', sshTarget: 'c', remotePort: 4000, localPort: AUTO_LOCAL_PORT_BASE + 2, autoConnect: true },
    ])
  })

  it('reads an absent roster as empty', () => {
    expect(resolveDevices({})).toEqual([])
  })
})

describe('resolveConfig', () => {
  it('materializes every timing knob for a caller that skipped the schema', () => {
    expect(resolveConfig({})).toEqual({
      devices: [],
      reconnectInitialMs: 1000,
      reconnectMaxMs: 30_000,
      probeIntervalMs: 1000,
      probeTimeoutMs: 4000,
      terminateGraceMs: 3000,
    })
  })
})

describe('classifyTunnelExit', () => {
  it('names each fatal family and leaves everything else transient', () => {
    expect(classifyTunnelExit('Permission denied (publickey).')).toMatch(/authentication failed/)
    expect(classifyTunnelExit('Host key verification failed.')).toMatch(/host key verification failed/)
    expect(classifyTunnelExit('ssh: Could not resolve hostname work: Name or service not known')).toMatch(/did not resolve/)
    expect(classifyTunnelExit('Bad local forwarding specification')).toMatch(/rejected the forwarding/)
    expect(classifyTunnelExit('channel_setup_fwd_listener_tcpip: cannot listen to port: 13389')).toMatch(/already bound/)
    expect(classifyTunnelExit('bind: Address already in use')).toMatch(/already bound/)
    expect(classifyTunnelExit('Connection timed out during banner exchange')).toBeUndefined()
    expect(classifyTunnelExit('')).toBeUndefined()
  })
})

describe('RemoteTunnels', () => {
  it('idles with an empty roster', async () => {
    const bench = await boot({})
    expect(bench.service.list()).toEqual([])
    await bench.ctx.fiber.dispose()
  })

  it('fails loud at load when ssh is not on PATH', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSubprocess).await()
    ;(ctx.subprocess as unknown as FakeSubprocess).sshAvailable = false
    const fiber = ctx.plugin(RemoteTunnels, {})
    await expect(fiber.await()).rejects.toThrow(/no "ssh" client on PATH/)
    await ctx.fiber.dispose()
  })

  it('fails loud at load on an invalid entry roster', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSubprocess).await()
    const fiber = ctx.plugin(RemoteTunnels, { devices: [{ id: 'a', sshTarget: 'x' }, { id: 'a', sshTarget: 'y' }] })
    await expect(fiber.await()).rejects.toThrow(/duplicate id/)
    await ctx.fiber.dispose()
  })

  it('rejects unknown device ids on both verbs', async () => {
    const bench = await boot({})
    // connect has nothing to await before the verdict, so it throws synchronously.
    let caught: unknown
    try {
      void bench.service.connect('ghost')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RemoteTunnelError)
    expect(caught).toMatchObject({ code: 'REMOTE_UNKNOWN_DEVICE' })
    await expect(bench.service.disconnect('ghost')).rejects.toThrow(/not configured/)
    await bench.ctx.fiber.dispose()
  })

  it('spawns the batch-mode forward and turns ready when the web UI answers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const bench = await boot({ devices: [{ id: 'work', label: 'Work', sshTarget: 'work', autoConnect: true }] })

    const view = await until(bench.service, 'work', 'ready')
    expect(view).toMatchObject({
      id: 'work',
      label: 'Work',
      sshTarget: 'work',
      remotePort: 3080,
      localPort: AUTO_LOCAL_PORT_BASE,
      autoConnect: true,
      url: `http://127.0.0.1:${String(AUTO_LOCAL_PORT_BASE)}/`,
    })
    expect(view.detail).toBeUndefined()
    expect(bench.fake.specs[0]?.argv).toEqual([
      'ssh', '-N', '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=2',
      '-L', `${AUTO_LOCAL_PORT_BASE}:127.0.0.1:3080`,
      'work',
    ])
    expect(bench.fake.specs[0]?.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 1024 },
      stderr: { maxBytes: 4096 },
    })
    expect(fetchSpy.mock.calls.some((call) => {
      const target: unknown = call[0]
      return typeof target === 'string' && target.includes(`127.0.0.1:${String(AUTO_LOCAL_PORT_BASE)}`)
    })).toBe(true)

    // A second connect while live is a no-op.
    await bench.service.connect('work')
    expect(bench.fake.handles).toHaveLength(1)
    await bench.ctx.fiber.dispose()
  })

  it('reports a refused probe and keeps connecting', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')

    const deadline = Date.now() + 3000
    for (;;) {
      const view = bench.service.list().find(row => row.id === 'work')
      if (view?.detail !== undefined) {
        expect(view.tunnel).toBe('connecting')
        expect(view.detail).toContain('not answering')
        expect(view.url).toBeUndefined()
        break
      }
      if (Date.now() > deadline) throw new Error('probe detail never landed')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await bench.ctx.fiber.dispose()
  })

  it('reports a non-2xx answer and keeps connecting', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 502 }))
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')

    const deadline = Date.now() + 3000
    for (;;) {
      const view = bench.service.list().find(row => row.id === 'work')
      if (view?.detail !== undefined) {
        expect(view.detail).toContain('HTTP 502')
        break
      }
      if (Date.now() > deadline) throw new Error('probe detail never landed')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await bench.ctx.fiber.dispose()
  })

  it('reports a probe timeout and generic probe failures', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValue('bang')
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')

    const seen: string[] = []
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && seen.length < 3) {
      const detail = bench.service.list().find(row => row.id === 'work')?.detail
      if (detail !== undefined && seen.at(-1) !== detail) seen.push(detail)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(seen[0]).toContain('timed out')
    expect(seen[1]).toContain('probe failed: boom')
    // A rejection that is not an Error still renders readable.
    expect(seen[2]).toContain('probe failed: bang')
    expect(fetchSpy).toHaveBeenCalled()
    await bench.ctx.fiber.dispose()
  })

  it('survives a probe body that fails to drain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 502,
      body: { cancel: () => Promise.reject(new Error('stream gone')) },
    } as unknown as Response)
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')

    const view = await untilDetail(bench.service, 'work', /HTTP 502/)
    expect(view.tunnel).toBe('connecting')
    await bench.ctx.fiber.dispose()
  })

  it('treats a missing stderr capture as an empty tail on exit', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    bench.fake.bareNext = true
    await bench.service.connect('work')
    bench.fake.handles[0]?.exit({ exitCode: 1, signal: null })

    const view = await untilDetail(bench.service, 'work', /exit code 1/)
    expect(view.tunnel).toBe('connecting')
    await bench.ctx.fiber.dispose()
  })

  it('turns a fatal exit into failed without reconnecting', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    bench.fake.handles[0]?.exit({ exitCode: 255, signal: null }, 'Permission denied (publickey).')

    const view = await until(bench.service, 'work', 'failed')
    expect(view.detail).toContain('authentication failed')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(bench.fake.handles).toHaveLength(1)
    await bench.ctx.fiber.dispose()
  })

  it('turns a spawn-level failure into failed, whatever it rejected with', async () => {
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }, { id: 'hk', sshTarget: 'hk' }] })
    bench.fake.spawnErrors.push('spawn ssh ENOENT', new Error('resolver exploded'))
    await bench.service.connect('work')
    await bench.service.connect('hk')

    const work = await until(bench.service, 'work', 'failed')
    const hk = await until(bench.service, 'hk', 'failed')
    expect(work.detail).toContain('ssh failed to start: spawn ssh ENOENT')
    expect(hk.detail).toContain('ssh failed to start: resolver exploded')
    await bench.ctx.fiber.dispose()
  })

  it('reconnects an unexpected exit with doubling backoff until ready', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')

    // First drop: exit code. Second drop: signal. Both transient.
    bench.fake.handles[0]?.exit({ exitCode: 255, signal: null }, 'some weird crash')
    const reconnecting = await untilDetail(bench.service, 'work', /exited unexpectedly/)
    expect(reconnecting.tunnel).toBe('connecting')
    expect(reconnecting.detail).toContain('exit code 255')
    expect(reconnecting.detail).toContain('reconnecting')

    const deadline = Date.now() + 3000
    while (bench.fake.handles.length < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(2)

    bench.fake.handles[1]?.exit({ exitCode: null, signal: 'SIGPIPE' }, '')
    // The signal detail lives until the next respawn's first probe, so read it
    // inside the backoff window.
    await untilDetail(bench.service, 'work', /signal SIGPIPE/)
    const deadline2 = Date.now() + 3000
    while (bench.fake.handles.length < 3 && Date.now() < deadline2) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(3)

    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }))
    const ready = await until(bench.service, 'work', 'ready')
    expect(ready.url).toBe(`http://127.0.0.1:${String(AUTO_LOCAL_PORT_BASE)}/`)
    await bench.ctx.fiber.dispose()
  })

  it('clips a long exit diagnostic to the detail bound', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    bench.fake.handles[0]?.exit({ exitCode: 1, signal: null }, `x${'y'.repeat(500)}`)

    const view = await untilDetail(bench.service, 'work', /exited unexpectedly/)
    expect(view.detail?.length ?? 0).toBeLessThanOrEqual(260)
    expect(view.detail).toContain('…')
    await bench.ctx.fiber.dispose()
  })

  it('disconnect terminates the process, awaits its exit, and clears the view', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    expect(bench.fake.handles).toHaveLength(1)

    const view = await bench.service.disconnect('work')
    expect(view.tunnel).toBe('disconnected')
    expect(view.detail).toBeUndefined()
    expect(bench.fake.handles[0]?.terminated).toBe(true)
    await bench.ctx.fiber.dispose()
  })

  it('disconnect during a pending backoff spawns nothing more', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    bench.fake.handles[0]?.exit({ exitCode: 255, signal: null }, 'weird crash')

    await untilDetail(bench.service, 'work', /reconnecting/)
    await bench.service.disconnect('work')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(bench.fake.handles).toHaveLength(1)
    await bench.ctx.fiber.dispose()
  })

  it('connect during a pending backoff respawns immediately', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    bench.fake.handles[0]?.exit({ exitCode: 255, signal: null }, 'weird crash')
    await untilDetail(bench.service, 'work', /reconnecting/)

    await bench.service.connect('work')
    expect(bench.fake.handles).toHaveLength(2)
    await until(bench.service, 'work', 'ready')
    await bench.ctx.fiber.dispose()
  })

  it('disconnect returns even when the process tree outlives its escalation', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({ devices: [{ id: 'work', sshTarget: 'work' }] })
    await bench.service.connect('work')
    const handle = bench.fake.handles[0]
    if (handle === undefined) throw new Error('expected a live handle')
    handle.wedged = true

    const view = await bench.service.disconnect('work')
    expect(view.tunnel).toBe('disconnected')
    expect(handle.terminated).toBe(true)
    await bench.ctx.fiber.dispose()
  }, 10_000)

  it('disposal terminates every live tunnel', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(refusedError())
    const bench = await boot({
      devices: [
        { id: 'a', sshTarget: 'a', autoConnect: true },
        { id: 'b', sshTarget: 'b', autoConnect: true },
      ],
    })
    await until(bench.service, 'a', 'connecting')
    await until(bench.service, 'b', 'connecting')

    await bench.ctx.fiber.dispose()
    expect(bench.fake.handles).toHaveLength(2)
    expect(bench.fake.handles.every(handle => handle.terminated)).toBe(true)
  })
})
