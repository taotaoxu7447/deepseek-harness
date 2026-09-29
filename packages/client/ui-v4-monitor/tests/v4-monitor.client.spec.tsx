// @vitest-environment jsdom
/**
 * ui-v4-monitor browser half on a real cordis Context with fake slots and
 * Remote faces: the plugin registers the dock entry at
 * conversation.input.dock and the toggle at sidebar.footer.action, the
 * polling source reads the v4Monitor namespace only while subscribed and
 * re-arms on the Host-reported interval, the first snapshot seeds the
 * collapsed state from autoCollapse, the toggle verb writes setEnabled
 * through the Host, and fiber disposal drops both entries (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { V4MonitorSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { V4MonitorDockFace, V4MonitorToggleFace } from '../src/client/v4-monitor-controller.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const STATE: NonNullable<V4MonitorSnapshot['state']> = {
  ts: 1787419669.2,
  engine: { healthy: true, alias: 'deepseek-v4-flash-0731', error: null },
  slots: [{
    id: 0, state: 'decoding', task: 320167, n_ctx: 262144, prompt_tokens: 124752,
    prompt_processed: 0, prefill_progress: 0, prefill_tps: 0, decode_tps: 142.5,
    decoded: 120, n_remain: -1, ctx_usage: 0.4759, speculative: true,
  }],
  history: [],
  age_s: 1.3,
  stale: false,
}

/** Boot the plugin over fake faces; the Remote namespace records calls and answers per script. */
async function bench(options: { snapshots?: V4MonitorSnapshot[] } = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const calls = { read: [] as Array<unknown[]>, setEnabled: [] as Array<unknown[]> }
  const script = options.snapshots ?? []
  // A real Service seat for `remote`: namespace access resolves through it.
  class RemoteStub extends Service {}
  new RemoteStub(ctx, 'remote')
  ctx.provide('remote.v4Monitor', {
    read: (...args: unknown[]) => {
      calls.read.push(args)
      const index = Math.min(calls.read.length - 1, script.length - 1)
      return Promise.resolve({ ok: true, value: script[index] })
    },
    setEnabled: (enabled: unknown) => {
      calls.setEnabled.push([enabled])
      return Promise.resolve({ ok: true, value: undefined })
    },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const dockEntry = () => {
    const entry = ctx.slots.entries('conversation.input.dock')[0]
    if (entry === undefined) return undefined
    return {
      ...entry.options,
      locale: entry.locale,
      inject: entry.inject as unknown as (sessionId: string) => V4MonitorDockFace,
    }
  }
  const toggleEntry = () => {
    const entry = ctx.slots.entries('sidebar.footer.action')[0]
    if (entry === undefined) return undefined
    return {
      ...entry.options,
      inject: entry.inject as unknown as () => V4MonitorToggleFace,
    }
  }
  return { ctx, fiber, calls, dockEntry, toggleEntry }
}

describe('ui-v4-monitor browser plugin', () => {
  it('registers the dock and the sidebar toggle', async () => {
    const b = await bench()
    expect(b.dockEntry()).toMatchObject({ id: 'v4-monitor', order: 5 })
    expect(b.dockEntry()?.locale).toBe('v4Monitor')
    expect(b.toggleEntry()).toMatchObject({ id: 'v4-monitor-toggle', order: 5 })
  })

  it('seeds collapsed from autoCollapse on the first snapshot and adopts the Host interval', async () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    const b = await bench({
      snapshots: [{
        enabled: true, configured: true, pollIntervalMs: 2000, autoCollapse: true, state: STATE,
      }],
    })
    const dock = b.dockEntry()!.inject!('s1' as never)
    const dispose = dock.hooks.v4Dock.subscribe(() => {})
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(dock.hooks.v4Dock.getSnapshot()).toMatchObject({
        enabled: true, collapsed: true, data: STATE, pollIntervalMs: 2000,
      })
      await vi.advanceTimersByTimeAsync(2000)
      expect(b.calls.read.length).toBe(2)
    } finally {
      dispose()
    }
    await vi.advanceTimersByTimeAsync(4000)
    expect(b.calls.read.length).toBe(2)
  })

  it('toggleCollapse flips only the local collapsed flag', async () => {
    const b = await bench({
      snapshots: [{ enabled: true, configured: true, pollIntervalMs: 2000, autoCollapse: false, state: STATE }],
    })
    const dock = b.dockEntry()!.inject!('s1' as never)
    const dispose = dock.hooks.v4Dock.subscribe(() => {})
    try {
      await Promise.resolve()
      expect(dock.hooks.v4Dock.getSnapshot().collapsed).toBe(false)
      dock.toggleCollapse()
      expect(dock.hooks.v4Dock.getSnapshot().collapsed).toBe(true)
      expect(b.calls.setEnabled).toEqual([])
    } finally {
      dispose()
    }
  })

  it('toggleEnabled writes setEnabled through the Host and reconciles', async () => {
    const b = await bench({
      snapshots: [
        { enabled: false, configured: true, pollIntervalMs: 2000, autoCollapse: false, state: null },
        { enabled: true, configured: true, pollIntervalMs: 2000, autoCollapse: false, state: STATE },
      ],
    })
    const toggle = b.toggleEntry()!.inject!()
    const dispose = toggle.hooks.v4Dock.subscribe(() => {})
    try {
      await Promise.resolve()
      expect(toggle.hooks.v4Dock.getSnapshot().enabled).toBe(false)
      toggle.toggleEnabled()
      expect(b.calls.setEnabled).toEqual([[true]])
      expect(toggle.hooks.v4Dock.getSnapshot().enabled).toBe(true)
      await Promise.resolve()
      await Promise.resolve()
      expect(toggle.hooks.v4Dock.getSnapshot().data).toEqual(STATE)
    } finally {
      dispose()
    }
  })

  it('drops both entries when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    expect(b.dockEntry()).toBeDefined()
    expect(b.toggleEntry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.dockEntry()).toBeUndefined()
    expect(b.toggleEntry()).toBeUndefined()
  })
})

describe('ui-v4-monitor node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
