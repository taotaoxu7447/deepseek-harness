// @vitest-environment jsdom
/**
 * ui-deepseek-balance browser half on a real cordis Context with fake slots
 * and Remote faces: the plugin registers the capsule entry at
 * conversation.input.right and the toggle at sidebar.footer.action, the
 * polling source reads the deepseekBalance namespace only while subscribed,
 * a connection reset forces one re-read, the toggle verb writes setEnabled
 * through the Host and reconciles optimistically, and fiber disposal drops
 * both entries (HMR safety). The node half stays inert.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { BalanceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { BalanceCapsuleFace, BalanceState, BalanceToggleFace } from '../src/client/balance-controller.ts'
import { apply, inject } from '../src/client/index.ts'
import { BalanceCapsule } from '../src/client/BalanceCapsule.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const BALANCE: NonNullable<BalanceSnapshot['balance']> = {
  currency: 'CNY',
  total: '88.50',
  available: true,
  period: 'valley',
  periodLabel: '梁文谷',
  consumption: { daily: [], monthly: [] },
}

interface RemoteCalls {
  read: Array<unknown[]>
  setEnabled: Array<unknown[]>
}

/** Boot the plugin over fake faces; the Remote namespace records calls and answers per script. */
async function bench(options: { snapshots?: BalanceSnapshot[]; failReads?: boolean } = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const calls: RemoteCalls = { read: [], setEnabled: [] }
  const script = options.snapshots ?? []
  // A real Service seat for `remote`: namespace access resolves through it.
  class RemoteStub extends Service {}
  new RemoteStub(ctx, 'remote')
  ctx.provide('remote.deepseekBalance', {
    read: (...args: unknown[]) => {
      calls.read.push(args)
      if (options.failReads === true) return Promise.resolve({ ok: false, error: { code: 'gateway/internal' } })
      return Promise.resolve({ ok: true, value: script[Math.min(calls.read.length - 1, script.length - 1)] })
    },
    setEnabled: (enabled: unknown) => {
      calls.setEnabled.push([enabled])
      return Promise.resolve({ ok: true, value: undefined })
    },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const capsuleEntry = () => {
    const entry = ctx.slots.entries('conversation.input.right')[0]
    if (entry === undefined) return undefined
    return {
      ...entry.options,
      locale: entry.locale,
      inject: entry.inject as unknown as (sessionId: string) => BalanceCapsuleFace,
    }
  }
  const toggleEntry = () => {
    const entry = ctx.slots.entries('sidebar.footer.action')[0]
    if (entry === undefined) return undefined
    return {
      ...entry.options,
      inject: entry.inject as unknown as () => BalanceToggleFace,
    }
  }
  return { ctx, fiber, calls, capsuleEntry, toggleEntry }
}

describe('ui-deepseek-balance browser plugin', () => {
  it('registers the capsule and the sidebar toggle', async () => {
    const b = await bench()
    expect(b.capsuleEntry()).toMatchObject({ id: 'deepseek-balance', order: 100 })
    expect(b.capsuleEntry()?.locale).toBe('deepseekBalance')
    expect(b.toggleEntry()).toMatchObject({ id: 'deepseek-balance-toggle', order: 15 })
    expect(b.capsuleEntry()?.inject).toBeTypeOf('function')
    expect(b.toggleEntry()?.inject).toBeTypeOf('function')
  })

  it('polls the namespace while subscribed and stops after the last unsubscribe', async () => {
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    const b = await bench({ snapshots: [{ enabled: true, balance: BALANCE }] })
    const source = b.capsuleEntry()!.inject!('s1' as never).hooks.balance
    const dispose = source.subscribe(() => {})
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(b.calls.read.length).toBe(1)
      expect(source.getSnapshot()).toEqual({ enabled: true, balance: BALANCE })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(b.calls.read.length).toBe(2)
    } finally {
      dispose()
    }
    await vi.advanceTimersByTimeAsync(120_000)
    expect(b.calls.read.length).toBe(2)
  })

  it('keeps the last good snapshot when a read fails', async () => {
    const b = await bench({ snapshots: [{ enabled: true, balance: BALANCE }] })
    const source = b.capsuleEntry()!.inject!('s1' as never).hooks.balance
    const dispose = source.subscribe(() => {})
    try {
      await Promise.resolve()
      expect(source.getSnapshot().balance).toEqual(BALANCE)
      ;(b.ctx.get('remote.deepseekBalance') as { failReads: boolean }).failReads = true
      await Promise.resolve()
      expect(source.getSnapshot().balance).toEqual(BALANCE)
    } finally {
      dispose()
    }
  })

  it('re-reads once after a connection reset', async () => {
    const b = await bench({ snapshots: [{ enabled: true, balance: BALANCE }] })
    const source = b.capsuleEntry()!.inject!('s1' as never).hooks.balance
    const dispose = source.subscribe(() => {})
    try {
      await Promise.resolve()
      expect(b.calls.read.length).toBe(1)
      b.ctx.emit('connection/reset')
      await Promise.resolve()
      expect(b.calls.read.length).toBe(2)
      expect(b.calls.read.at(-1)).toEqual([true])
    } finally {
      dispose()
    }
  })

  it('toggleEnabled writes setEnabled through the Host and reconciles optimistically', async () => {
    const b = await bench({ snapshots: [{ enabled: true, balance: BALANCE }, { enabled: false, balance: null }] })
    const toggle = b.toggleEntry()!.inject!()
    const dispose = toggle.hooks.balance.subscribe(() => {})
    try {
      await Promise.resolve()
      expect(toggle.hooks.balance.getSnapshot().enabled).toBe(true)
      toggle.toggleEnabled()
      expect(b.calls.setEnabled).toEqual([[false]])
      await Promise.resolve()
      await Promise.resolve()
      expect(toggle.hooks.balance.getSnapshot().enabled).toBe(false)
      expect(toggle.hooks.balance.getSnapshot().balance).toBeNull()
    } finally {
      dispose()
    }
  })

  it('drops both entries when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    expect(b.capsuleEntry()).toBeDefined()
    expect(b.toggleEntry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.capsuleEntry()).toBeUndefined()
    expect(b.toggleEntry()).toBeUndefined()
  })
})

describe('BalanceCapsule adapter', () => {
  const t = makeTranslate(zh, commonZh)

  function capsuleProps(state: BalanceState) {
    const useBalance = (selector: (snapshot: BalanceState) => unknown) => selector(state)
    return { t, useBalance } as unknown as Parameters<typeof BalanceCapsule>[0]
  }

  it('renders the formatted balance with its period label', () => {
    const shown = render(<BalanceCapsule {...capsuleProps({ enabled: true, balance: BALANCE })} />)
    expect(shown.getByText('¥88.50')).toBeTruthy()
    expect(shown.getByText('梁文谷')).toBeTruthy()
  })

  it('renders nothing when disabled or before the first read', () => {
    for (const state of [{ enabled: false, balance: BALANCE }, { enabled: true, balance: null }] as BalanceState[]) {
      const empty = render(<BalanceCapsule {...capsuleProps(state)} />)
      expect(empty.container.firstChild).toBeNull()
      cleanup()
    }
  })
})

describe('ui-deepseek-balance node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
