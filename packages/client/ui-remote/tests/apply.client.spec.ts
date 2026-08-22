// @vitest-environment jsdom
// Client apply wiring: the `remoteEntry` dictionaries register, the sidebar
// footer action lands with its controller inject, and teardown clears both.
// Node half and the invariant companion ride along.

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS, zh } from '@deepseek-ai/dsh-client-ui-remote/client'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-remote'
import * as invariant from '@deepseek-ai/dsh-client-ui-remote/invariant'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The lane has no jsdom navigator language; stage zh explicitly.
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      remote: {
        list: vi.fn(() => Promise.resolve({ rpcId: 'r' as never, result: { ok: true, value: { devices: [] } } })),
      },
    },
  } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('layout', { openRemoteTab: vi.fn() } as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The sidebar shell owns this declaration; stand it in for the bench.
  slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots }
}

describe('ui-remote client apply', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'settingsScope', 'layout'])
  })

  it('registers the dictionaries and the footer action', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const locale = ctx.get('locale') as LocaleRuntime
    expect(locale.bind(NS)('trigger.label')).toBe(zh['trigger.label'])

    const entries = slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'remote-entry', order: 0 })
    // The inject factory builds the controller face with its snapshot hook.
    // Its owner-parameter type is this slot's never seat; the factory ignores
    // it at runtime, so a cast empty object satisfies both sides.
    const injectFace = entries[0]!.inject as (owner: never) => Record<string, unknown>
    const face = injectFace({} as never)
    expect(Object.keys(face.hooks as Record<string, unknown>)).toContain('remoteEntry')
    expect(face.setOpen).toBeTypeOf('function')
  })

  it('teardown clears the registration and the dictionaries', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()

    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    // The dictionaries left with the fiber: an unregistered namespace resolves
    // to the bare key.
    const locale = ctx.get('locale') as LocaleRuntime
    expect(locale.bind(NS)('trigger.label')).toBe('trigger.label')
  })
})

describe('node half + invariant companion', () => {
  it('node apply is an intentional no-op (loader-managed lifecycle only)', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('invariant companion registers under the package name', async () => {
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = { invariants: { register } } as never
    // The /invariant subpath types live in lib/types (build product); assert
    // the API so the call stays typed where lint runs without a build.
    const dispose = await (invariant as { apply: (ctx: never) => Promise<() => void> }).apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-remote', expect.any(Function))
    // The installer is the declared no-op — calling it must not throw.
    expect(() => { (register.mock.calls[0]![1] as (c: never) => void)(undefined as never) }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
