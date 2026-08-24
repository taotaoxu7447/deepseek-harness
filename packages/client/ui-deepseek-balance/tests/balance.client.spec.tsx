// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { BalanceController, formatBalance } from '../src/client/balance-controller.ts'
import { BalanceCapsule } from '../src/client/BalanceCapsule.tsx'
import { en } from '../src/client/locales.ts'
import type { BalanceView } from '@deepseek-ai/dsh-host-apiproxy/api'

const MOCK_BALANCE: BalanceView = {
  currency: 'CNY',
  total: '88.5',
  available: true,
}

function scope(enabled?: boolean) {
  return createSnapshotStore({
    status: 'ready' as const,
    writable: true,
    value: enabled === undefined ? {} : { enabled },
    secrets: [],
  })
}

describe('formatBalance', () => {
  it('formats CNY and USD totals', () => {
    expect(formatBalance({ currency: 'CNY', total: '88.5', available: true })).toBe('¥88.50')
    expect(formatBalance({ currency: 'USD', total: '1.2', available: true })).toBe('$1.20')
  })
})

describe('BalanceController', () => {
  it('is on by default and off when the sidebar toggle writes false', () => {
    const api = {
      balance: {
        get: vi.fn().mockResolvedValue({ result: { ok: true, value: { balance: MOCK_BALANCE } } }),
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
        get: vi.fn().mockResolvedValue({ result: { ok: true, value: { balance: MOCK_BALANCE } } }),
      },
    }
    const controller = new BalanceController(scope(true) as never, api)
    expect(api.balance.get).not.toHaveBeenCalled()
    const store = controller.injectCapsule().hooks.balance
    const off = store.subscribe(() => {})
    await vi.waitFor(() => {
      expect(store.getSnapshot().data).toEqual(MOCK_BALANCE)
    })
    off()
    controller.dispose()
  })
})

describe('BalanceCapsule', () => {
  it('renders the formatted official balance and hides when disabled', () => {
    const store = createSnapshotStore({ enabled: true, data: MOCK_BALANCE })
    const t = (k: keyof typeof en, vars?: Record<string, string | number>) => {
      let text = en[k]
      if (vars) {
        for (const [key, val] of Object.entries(vars)) {
          text = text.replace(`{${key}}`, String(val))
        }
      }
      return text
    }

    const view = render(
      <BalanceCapsule
        t={t as never}
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
    expect(screen.getByText('¥88.50')).toBeTruthy()

    act(() => {
      store.set({ enabled: false, data: MOCK_BALANCE })
    })
    expect(view.queryByText('¥88.50')).toBeNull()
  })
})
