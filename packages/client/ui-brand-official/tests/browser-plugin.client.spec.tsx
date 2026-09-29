// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import {
  type BrandNameInjected, type BrandTagSettings,
  OfficialBrandMark, OfficialBrandName,
} from '../src/client/Brand.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const stub = stubSettingsScope<BrandTagSettings>()
  ctx.provide('settingsScope', { bind: () => stub.scope } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, stub, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('declares the slot and settingsScope services it uses', () => {
    expect(inject).toEqual(['slots', 'settingsScope'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('wires settingsScope into the sidebar.brand.name slot registration', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = subject.slots.entries('sidebar.brand.name')[0]!
    expect(entry.component).toBe(OfficialBrandName)
    const injected = (entry.inject as unknown as () => BrandNameInjected)()
    expect(injected.hooks.brandTagSettings).toBe(subject.stub.scope)
  })

  it('renders the official name independently from both requested mark sizes', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('26 0 194.5 24')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} className="hero-mark" />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('hero-mark')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })

  it('renders default TAO tag when settings are unconfigured or loading', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.textContent).toContain('TAO')
    expect(name.container.textContent).toContain('HARNESS')
    const plate = name.container.querySelector('.dsh-brand-tag-plate')
    expect(plate?.getAttribute('stroke')).toBe('#00e5ff')
  })

  it('re-renders with custom tag text and colors when brand-tag settings update', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    const useBrandTagSettings = bindSnapshotSelector(stub.scope)
    const name = render(<OfficialBrandName useBrandTagSettings={useBrandTagSettings} />)

    expect(name.container.textContent).toContain('TAO')

    act(() => {
      stub.publish({
        status: 'ready',
        value: {
          text: 'CUSTOM',
          strokeColor: '#ff007f',
          fillColorLight: '#fefefe',
          fillColorDark: '#1a1a1a',
        },
      })
    })

    expect(name.container.textContent).toContain('CUSTOM')
    const plate = name.container.querySelector('.dsh-brand-tag-plate')
    expect(plate?.getAttribute('stroke')).toBe('#ff007f')
    expect(name.container.querySelector('style')?.textContent).toContain('#fefefe')
    expect(name.container.querySelector('style')?.textContent).toContain('#1a1a1a')
  })
})
