// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { BalanceController, formatBalance } from '../src/client/balance-controller.ts'
import { BalanceCapsule } from '../src/client/BalanceCapsule.tsx'
import { ConsumptionPopover, formatCurrency } from '../src/client/ConsumptionPopover.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { BalanceView } from '@deepseek-ai/dsh-host-apiproxy/api'

afterEach(cleanup)

const MOCK_PEAK_BALANCE: BalanceView = {
  currency: 'CNY',
  total: '88.5',
  available: true,
  period: 'peak',
  periodLabel: '梁文峰',
  consumption: {
    daily: [
      { key: '2026-08-23', label: '8/23', amount: 5.2 },
      { key: '2026-08-24', label: '8/24', amount: 3.45 },
    ],
    monthly: [
      { key: '2026-07', label: '7月', amount: 45.0 },
      { key: '2026-08', label: '8月', amount: 28.5 },
    ],
  },
}

const MOCK_VALLEY_BALANCE: BalanceView = {
  currency: 'CNY',
  total: '100.0',
  available: true,
  period: 'valley',
  periodLabel: '梁文谷',
  consumption: {
    daily: [
      { key: '2026-08-24', label: '8/24', amount: 1.2 },
    ],
    monthly: [
      { key: '2026-08', label: '8月', amount: 12.0 },
    ],
  },
}

function scope(enabled?: boolean) {
  return createSnapshotStore({
    status: 'ready' as const,
    writable: true,
    value: enabled === undefined ? {} : { enabled },
    secrets: [],
  })
}

function makeTranslate(dict: Record<string, string> = zh) {
  return (k: string, vars?: Record<string, string | number>) => {
    let text = dict[k] ?? k
    if (vars) {
      for (const [key, val] of Object.entries(vars)) {
        text = text.replace(`{${key}}`, String(val))
      }
    }
    return text
  }
}

function renderCapsule(balanceData: BalanceView | null, enabled = true, dict = zh) {
  const store = createSnapshotStore({ enabled, data: balanceData })
  const result = render(
    <BalanceCapsule
      t={makeTranslate(dict) as never}
      useBalance={bindSnapshotSelector(store)}
      sessionId={'session-test' as never}
      session={{} as never}
      input={{} as never}
      useSession={(() => ({})) as never}
      useInput={(() => ({})) as never}
      inputActions={{} as never}
      useProjection={(() => null) as never}
      useSessions={(() => ({})) as never}
      useWorkspaces={(() => ({})) as never}
    />,
  )
  return { store, ...result }
}

describe('formatBalance & formatCurrency', () => {
  it('formats CNY and USD totals', () => {
    expect(formatBalance({ currency: 'CNY', total: '88.5', available: true } as BalanceView)).toBe('¥88.50')
    expect(formatBalance({ currency: 'USD', total: '1.2', available: true } as BalanceView)).toBe('$1.20')
    expect(formatBalance({ currency: 'EUR', total: '10.5', available: true } as BalanceView)).toBe('10.50 EUR')
  })

  it('formats consumption currencies correctly', () => {
    expect(formatCurrency(3.45, 'CNY')).toBe('¥3.45')
    expect(formatCurrency(1.2, 'USD')).toBe('$1.20')
    expect(formatCurrency(5.0, 'EUR')).toBe('5.00 EUR')
  })
})

describe('BalanceController', () => {
  it('is on by default and off when the sidebar toggle writes false', () => {
    const api = {
      balance: {
        get: vi.fn().mockResolvedValue({ result: { ok: true, value: { balance: MOCK_PEAK_BALANCE } } }),
      },
    }
    const controller = new BalanceController(scope() as never, api)
    expect(controller.injectToggle().hooks.balance.getSnapshot().enabled).toBe(true)
    controller.dispose()

    const off = new BalanceController(scope(false) as never, api)
    expect(off.injectToggle().hooks.balance.getSnapshot().enabled).toBe(false)
    off.dispose()
  })

  it('polls only while the capsule is subscribed and enabled', async () => {
    const api = {
      balance: {
        get: vi.fn().mockResolvedValue({ result: { ok: true, value: { balance: MOCK_PEAK_BALANCE } } }),
      },
    }
    const controller = new BalanceController(scope(true) as never, api)
    expect(api.balance.get).not.toHaveBeenCalled()
    const store = controller.injectCapsule().hooks.balance
    const off = store.subscribe(() => {})
    await vi.waitFor(() => {
      expect(store.getSnapshot().data).toEqual(MOCK_PEAK_BALANCE)
    })
    off()
    controller.dispose()
  })
})

describe('BalanceCapsule', () => {
  it('renders 梁文峰 and red theme class during peak hours', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    expect(screen.getByText('梁文峰')).toBeTruthy()
    expect(screen.getByText('¥88.50')).toBeTruthy()

    const button = screen.getByRole('button')
    expect(button.className).toContain('peak')
    expect(button.getAttribute('data-period')).toBe('peak')
  })

  it('renders 梁文谷 and blue theme class during valley hours', () => {
    renderCapsule(MOCK_VALLEY_BALANCE)
    expect(screen.getByText('梁文谷')).toBeTruthy()
    expect(screen.getByText('¥100.00')).toBeTruthy()

    const button = screen.getByRole('button')
    expect(button.className).toContain('valley')
    expect(button.getAttribute('data-period')).toBe('valley')
  })

  it('falls back to locale period strings when periodLabel is absent', () => {
    const dataWithoutLabel: BalanceView = {
      currency: 'CNY',
      total: '50.0',
      available: true,
      period: 'peak',
      periodLabel: '',
      consumption: { daily: [], monthly: [] },
    }
    renderCapsule(dataWithoutLabel, true, zh)
    expect(screen.getByText('梁文峰')).toBeTruthy()

    cleanup()
    renderCapsule({ ...dataWithoutLabel, period: 'valley' }, true, zh)
    expect(screen.getByText('梁文谷')).toBeTruthy()

    cleanup()
    renderCapsule(dataWithoutLabel, true, en)
    expect(screen.getByText('Peak')).toBeTruthy()
  })

  it('hides when disabled', () => {
    const { store } = renderCapsule(MOCK_PEAK_BALANCE, true)
    expect(screen.getByText('¥88.50')).toBeTruthy()

    act(() => {
      store.set({ enabled: false, data: MOCK_PEAK_BALANCE })
    })
    expect(screen.queryByText('¥88.50')).toBeNull()
  })

  it('clicking capsule opens the consumption popover and closes on second click', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    expect(screen.queryByRole('dialog')).toBeNull()

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('API 消费统计')).toBeTruthy()
    expect(screen.getByText('每日消费')).toBeTruthy()
    expect(screen.getByText('每月消费')).toBeTruthy()

    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches tabs between daily and monthly consumption charts', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    fireEvent.click(screen.getByRole('button'))

    // Default tab is daily
    const dailyTab = screen.getByRole('tab', { name: '每日消费' })
    const monthlyTab = screen.getByRole('tab', { name: '每月消费' })
    expect(dailyTab.getAttribute('aria-selected')).toBe('true')
    expect(monthlyTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('bar-2026-08-23')).toBeTruthy()
    expect(screen.getByTestId('bar-2026-08-24')).toBeTruthy()

    // Switch to monthly tab
    fireEvent.click(monthlyTab)
    expect(monthlyTab.getAttribute('aria-selected')).toBe('true')
    expect(dailyTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('bar-2026-07')).toBeTruthy()
    expect(screen.getByTestId('bar-2026-08')).toBeTruthy()
  })

  it('shows tooltip on hover', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    fireEvent.click(screen.getByRole('button'))

    const bar = screen.getByTestId('bar-2026-08-24')
    expect(screen.queryByTestId('consumption-tooltip')).toBeNull()

    fireEvent.mouseEnter(bar)
    expect(screen.getByTestId('consumption-tooltip')).toBeTruthy()
    expect(screen.getByTestId('consumption-tooltip').textContent).toContain('2026-08-24: ¥3.45')

    fireEvent.mouseLeave(bar)
    expect(screen.queryByTestId('consumption-tooltip')).toBeNull()
  })

  it('clicking outside closes the popover', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Click outside
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('pressing Escape closes the popover', () => {
    renderCapsule(MOCK_PEAK_BALANCE)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders empty state when consumption data is empty or undefined', () => {
    const emptyBalance: BalanceView = {
      ...MOCK_PEAK_BALANCE,
      consumption: { daily: [], monthly: [] },
    }
    renderCapsule(emptyBalance)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('暂无近期消费记录')).toBeTruthy()

    cleanup()
    const undefinedConsumptionBalance: BalanceView = {
      currency: 'CNY',
      total: '88.5',
      available: true,
      period: 'peak',
      periodLabel: '梁文峰',
      consumption: undefined as never,
    }
    renderCapsule(undefinedConsumptionBalance)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('暂无近期消费记录')).toBeTruthy()
  })

  it('supports USD currency formatting in Popover', () => {
    const usdBalance: BalanceView = {
      currency: 'USD',
      total: '20.0',
      available: true,
      period: 'peak',
      periodLabel: '梁文峰',
      consumption: {
        daily: [
          { key: '2026-08-24', label: '8/24', amount: 1.5 },
        ],
        monthly: [
          { key: '2026-08', label: '8月', amount: 10.0 },
        ],
      },
    }
    renderCapsule(usdBalance)
    fireEvent.click(screen.getByRole('button'))

    const bar = screen.getByTestId('bar-2026-08-24')
    fireEvent.mouseEnter(bar)
    expect(screen.getByTestId('consumption-tooltip').textContent).toContain('2026-08-24: $1.50')
  })
})

describe('ConsumptionPopover direct render', () => {
  it('renders standalone popover with onClose callback', () => {
    const onClose = vi.fn()
    render(
      <ConsumptionPopover
        consumption={MOCK_PEAK_BALANCE.consumption}
        currency="CNY"
        onClose={onClose}
        t={makeTranslate(zh) as never}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
