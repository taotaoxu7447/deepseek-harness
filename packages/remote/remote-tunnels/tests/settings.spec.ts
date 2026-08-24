/** The `remote` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import RemoteTunnels, { REMOTE_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-remote-tunnels'
import type { Config } from '@deepseek-ai/dsh-remote-tunnels'

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [String(ns)]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** A tunnel child that stays up until the roster terminates it. */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4321
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected = {}
  readonly done: Promise<SubprocessOutcome>
  terminated = false
  target: string | undefined
  private settle!: (outcome: SubprocessOutcome) => void

  constructor() {
    this.done = new Promise((resolve) => {
      this.settle = resolve
    })
  }

  terminate(): void {
    this.terminated = true
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(): Promise<boolean> {
    return this.done.then(() => true)
  }
}

/** A subprocess seam that records every spawned tunnel. */
class FakeSubprocess extends SubprocessRuntime {
  handles: FakeHandle[] = []

  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(`/usr/bin/${command}`)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = new FakeHandle()
    handle.target = spec.argv.at(-1)
    this.handles.push(handle)
    return handle
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used by remote-tunnels'))
  }
}

const ENTRY: Config = {
  devices: [{ id: 'entry-dev', sshTarget: 'entry-box' }],
  reconnectInitialMs: 50,
  reconnectMaxMs: 120,
  probeIntervalMs: 50,
  probeTimeoutMs: 100,
  terminateGraceMs: 100,
}

interface Bench {
  ctx: Context
  service: RemoteTunnels
  fake: FakeSubprocess
  settingsFiber: Fiber
  pluginFiber: Fiber
}

async function boot(): Promise<Bench> {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess).await()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(RemoteTunnels, structuredClone(ENTRY))
  await pluginFiber.await()
  return { ctx, service: ctx.remoteTunnels, fake: ctx.subprocess as unknown as FakeSubprocess, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('remote settings section', () => {
  it('takes over the roster live: a stored auto-connect device spawns without a restart', async () => {
    const bench = await boot()
    expect(bench.service.list().map(row => row.id)).toEqual(['entry-dev'])
    expect(bench.fake.handles).toHaveLength(0)

    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'stored', label: 'Stored', sshTarget: 'stored-box', autoConnect: true }],
    })

    expect(bench.service.list().map(row => row.id)).toEqual(['stored'])
    const deadline = Date.now() + 3000
    while (bench.fake.handles.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(1)
    expect(bench.fake.handles[0]?.target).toBe('stored-box')
    await bench.ctx.fiber.dispose()
  })

  it('restarts a tunnel on a connection-relevant edit but not on a label edit', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work', autoConnect: true }],
    })
    const deadline = Date.now() + 3000
    while (bench.fake.handles.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(1)

    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', label: 'Work Machine', sshTarget: 'work', autoConnect: true }],
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(bench.fake.handles).toHaveLength(1)
    expect(bench.fake.handles[0]?.terminated).toBe(false)
    expect(bench.service.list()[0]?.label).toBe('Work Machine')

    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', label: 'Work Machine', sshTarget: 'work-2', autoConnect: true }],
    })
    const deadline2 = Date.now() + 3000
    while (bench.fake.handles.length < 2 && Date.now() < deadline2) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(2)
    expect(bench.fake.handles[0]?.terminated).toBe(true)
    expect(bench.fake.handles[1]?.target).toBe('work-2')
    await bench.ctx.fiber.dispose()
  })

  it('terminates the tunnel of a removed device', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work', autoConnect: true }],
    })
    const deadline = Date.now() + 3000
    while (bench.fake.handles.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, { devices: [] })

    expect(bench.service.list()).toEqual([])
    expect(bench.fake.handles[0]?.terminated).toBe(true)
    await bench.ctx.fiber.dispose()
  })

  it('rejects an invalid section and keeps the prior roster authoritative', async () => {
    const bench = await boot()
    expect(bench.service.list().map(row => row.id)).toEqual(['entry-dev'])

    await expect(bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'a', sshTarget: 'x' }, { id: 'a', sshTarget: 'y' }],
    })).rejects.toThrow(/duplicate id/)

    expect(bench.service.list().map(row => row.id)).toEqual(['entry-dev'])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the entry roster when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'stored', sshTarget: 'stored-box' }],
    })
    expect(bench.service.list().map(row => row.id)).toEqual(['stored'])

    await bench.settingsFiber.dispose()

    expect(bench.service.list().map(row => row.id)).toEqual(['entry-dev'])
    await bench.ctx.fiber.dispose()
  })

  it('connects a retained device when autoConnect flips on, and leaves an unwanted device down across a connection edit', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work' }],
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(bench.fake.handles).toHaveLength(0)

    // Connection facts unchanged, autoConnect flipped on: the retained device connects.
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work', label: 'Work', autoConnect: true }],
    })
    const deadline = Date.now() + 3000
    while (bench.fake.handles.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.fake.handles).toHaveLength(1)

    // Down by user request, then the target moves: the swap stays down.
    await bench.service.disconnect('work')
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work-2' }],
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(bench.fake.handles).toHaveLength(1)
    expect(bench.service.list()[0]?.tunnel).toBe('disconnected')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace and terminates live tunnels when the plugin unloads', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(REMOTE_SETTINGS_NAMESPACE, {
      devices: [{ id: 'work', sshTarget: 'work', autoConnect: true }],
    })
    const deadline = Date.now() + 3000
    while (bench.fake.handles.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('remote')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('remote')
    expect(bench.fake.handles[0]?.terminated).toBe(true)
    await bench.ctx.fiber.dispose()
  })
})
