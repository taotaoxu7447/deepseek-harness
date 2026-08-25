// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply,
  inject,
  BrandTagRow,
  type BrandTagRowInjected,
  type BrandTagRowProps,
  type BrandTagSettings,
  COLOR_PRESETS,
  DEFAULT_BRAND_TAG_SETTINGS,
  NS,
  zh,
} from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function mountRow(stub: StubSettingsScope<BrandTagSettings>, useHook = true) {
  const props = {
    scope: stub.scope,
    useBrandTagSettings: useHook ? bindSnapshotSelector(stub.scope) : undefined,
    t: (key: string) => {
      const translation = zh[key as keyof typeof zh]
      return translation ?? key
    },
  } as unknown as BrandTagRowProps
  const view = render(<BrandTagRow {...props} />)
  return { ...view, stub }
}

describe('BrandTagRow component', () => {
  it('renders title, description, text input, color presets, and preview', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    expect(screen.getByText(zh['brandTag.title'])).toBeDefined()
    expect(screen.getByText(zh['brandTag.description'])).toBeDefined()

    const input = screen.getByPlaceholderText(zh['brandTag.textPlaceholder']) as HTMLInputElement
    expect(input).toBeDefined()
    expect(input.maxLength).toBe(8)

    for (const color of COLOR_PRESETS) {
      expect(screen.getByRole('radio', { name: color })).toBeDefined()
    }

    expect(screen.getByRole('button', { name: zh['brandTag.reset'] })).toBeDefined()
    expect(screen.getByText('TAO')).toBeDefined()
  })

  it('updates text in settings scope when user types', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    const input = screen.getByPlaceholderText(zh['brandTag.textPlaceholder'])
    fireEvent.change(input, { target: { value: 'CUSTOM' } })

    expect(stub.set).toHaveBeenCalledWith('text', 'CUSTOM')
  })

  it('enforces 8-character limit on text input', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    const input = screen.getByPlaceholderText(zh['brandTag.textPlaceholder'])
    fireEvent.change(input, { target: { value: 'LONGERTHAN8CHARS' } })

    expect(stub.set).toHaveBeenCalledWith('text', 'LONGERTH')
  })

  it('selects color preset and writes to settings scope', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    const colorChip = screen.getByRole('radio', { name: '#3b82f6' })
    fireEvent.click(colorChip)

    expect(stub.set).toHaveBeenCalledWith('strokeColor', '#3b82f6')
  })

  it('updates custom hex stroke color when user types in hex input', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    const hexInput = screen.getByPlaceholderText('#00e5ff')
    fireEvent.change(hexInput, { target: { value: '#ff007f' } })

    expect(stub.set).toHaveBeenCalledWith('strokeColor', '#ff007f')
  })

  it('resets to defaults when clicking reset', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    mountRow(stub)

    const resetButton = screen.getByRole('button', { name: zh['brandTag.reset'] })
    fireEvent.click(resetButton)

    expect(stub.set).toHaveBeenCalledWith('text', DEFAULT_BRAND_TAG_SETTINGS.text)
    expect(stub.set).toHaveBeenCalledWith('strokeColor', DEFAULT_BRAND_TAG_SETTINGS.strokeColor)
    expect(stub.set).toHaveBeenCalledWith('fillColorLight', DEFAULT_BRAND_TAG_SETTINGS.fillColorLight)
    expect(stub.set).toHaveBeenCalledWith('fillColorDark', DEFAULT_BRAND_TAG_SETTINGS.fillColorDark)
  })

  it('reflects updated settings in preview and input value when published', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    const { container } = mountRow(stub)

    act(() => {
      stub.publish({
        status: 'ready',
        value: {
          text: 'MYTAG',
          strokeColor: '#ef4444',
          fillColorLight: '#fefefe',
          fillColorDark: '#1a1a1a',
        },
      })
    })

    const input = screen.getByPlaceholderText(zh['brandTag.textPlaceholder']) as HTMLInputElement
    expect(input.value).toBe('MYTAG')
    expect(container.textContent).toContain('MYTAG')

    const activeChip = screen.getByRole('radio', { name: '#ef4444' })
    expect(activeChip.getAttribute('aria-checked')).toBe('true')
  })

  it('works reactively with fallback when useBrandTagSettings is omitted', () => {
    const stub = stubSettingsScope<BrandTagSettings>()
    const { container } = mountRow(stub, false)

    act(() => {
      stub.publish({
        status: 'ready',
        value: {
          text: 'NO_HOOK',
          strokeColor: '#8b5cf6',
        },
      })
    })

    const input = screen.getByPlaceholderText(zh['brandTag.textPlaceholder']) as HTMLInputElement
    expect(input.value).toBe('NO_HOOK')
    expect(container.textContent).toContain('NO_HOOK')
  })
})

describe('BrandTagRow slot registration', () => {
  it('registers BrandTagRow into settings.general.item slot with order 15', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const stub = stubSettingsScope<BrandTagSettings>()
    ctx.provide('settingsScope', { bind: () => stub.scope } as never)
    const slots = ctx.get('slots') as SlotRegistry

    slots.register({
      name: 'root',
      children: {
        'settings.general.item': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entries = slots.entries('settings.general.item')
    const brandTagEntry = entries.find(e => e.options.id === 'brand-tag')

    expect(brandTagEntry).toBeDefined()
    expect(brandTagEntry?.component).toBe(BrandTagRow)
    expect(brandTagEntry?.options).toMatchObject({
      id: 'brand-tag',
      order: 15,
    })
    expect(brandTagEntry?.locale).toBe(NS)

    const injected = (brandTagEntry?.inject as unknown as () => BrandTagRowInjected)()
    expect(injected.hooks.brandTagSettings).toBe(stub.scope)
    expect(injected.scope).toBe(stub.scope)

    await fiber.dispose()
    expect(slots.entries('settings.general.item')).toHaveLength(0)
  })
})
