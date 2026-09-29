// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { V4MonitorController } from '../src/client/v4-monitor-controller.ts'
import { V4MonitorDock } from '../src/client/V4MonitorDock.tsx'
import { en } from '../src/client/locales.ts'
import type { V4MonitorStateView } from '@deepseek-ai/dsh-host-apiproxy/api'

const MOCK_STATE: V4MonitorStateView = {
  ts: 1787419669.2,
  engine: { healthy: true, alias: 'deepseek-v4-flash-0731', error: null },
  slots: [
    {
      id: 0,
      state: 'decoding',
      task: 320167,
      n_ctx: 262144,
      prompt_tokens: 124752,
      prompt_processed: 0,
      prefill_progress: 0,
      prefill_tps: 0,
      decode_tps: 142.5,
      decoded: 120,
      n_remain: -1,
      ctx_usage: 0.4759,
      speculative: true,
    },
    {
      id: 1,
      state: 'idle',
      task: 0,
      n_ctx: 262144,
      prompt_tokens: 0,
      prompt_processed: 0,
      prefill_progress: 0,
      prefill_tps: 0,
      decode_tps: 0,
      decoded: 0,
      n_remain: -1,
      ctx_usage: 0,
    },
  ],
  history: [
    {
      slot: 0,
      task: 320167,
      prompt_tokens: 124752,
      decoded: 120,
      duration_s: 4.2,
      decode_tps_avg: 140.1,
      end_ts: 1787419668,
    },
  ],
  age_s: 1.3,
  stale: false,
}

function scope(enabled: boolean) {
  return createSnapshotStore({
    status: 'ready' as const,
    writable: true,
    value: { enabled },
    secrets: [],
  })
}

describe('V4MonitorController', () => {
  it('is off until the sidebar toggle enables it', () => {
    const api = {
      v4Monitor: {
        state: vi.fn().mockResolvedValue({ result: { ok: true, value: { state: MOCK_STATE } } }),
      },
    }
    const controller = new V4MonitorController(scope(false) as never, api)
    expect(controller.injectDock().hooks.v4Dock.getSnapshot().enabled).toBe(false)
    controller.dispose()
  })

  it('polls on demand when subscribed and enabled', async () => {
    const api = {
      v4Monitor: {
        state: vi.fn().mockResolvedValue({ result: { ok: true, value: { state: MOCK_STATE } } }),
      },
    }
    const controller = new V4MonitorController(scope(true) as never, api)
    const face = controller.injectDock()
    const unsubscribe = face.hooks.v4Dock.subscribe(() => {})
    await vi.waitFor(() => {
      expect(api.v4Monitor.state).toHaveBeenCalled()
    })
    unsubscribe()
    controller.dispose()
  })
})

describe('V4MonitorDock component', () => {
  it('renders dual slots when enabled, hides when disabled', () => {
    const store = createSnapshotStore({
      enabled: true,
      collapsed: false,
      data: MOCK_STATE,
      pollIntervalMs: 2000,
    })

    const t = (k: keyof typeof en, vars?: Record<string, string | number>) => {
      let text = en[k] ?? k
      if (vars) {
        for (const [key, val] of Object.entries(vars)) {
          text = text.replace(`{${key}}`, String(val))
        }
      }
      return text
    }

    render(
      <V4MonitorDock
        t={t as never}
        useV4Dock={bindSnapshotSelector(store)}
        toggleCollapse={vi.fn()}
        refresh={vi.fn(async () => {})}
        sessionId={'session-test' as never}
        session={{} as never}
        input={{} as never}
        useSession={(() => ({})) as never}
        useInput={(() => ({})) as never}
        inputActions={{} as never}
        useProjection={() => null}
        useSessions={(() => ({})) as never}
        useWorkspaces={(() => ({})) as never}
      />,
    )

    expect(screen.getByText(/DeepSeek V4 Flash/)).toBeTruthy()
    expect(screen.getByText('Slot 0')).toBeTruthy()
    expect(screen.getByText('Slot 1')).toBeTruthy()
    expect(screen.getByText(/Decoding 142.5 tok\/s/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true')

    act(() => {
      store.set({ ...store.getSnapshot(), collapsed: true })
    })
    expect(screen.getByRole('button', { name: 'Expand details' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('S0')).toBeTruthy()
    expect(screen.getByText('143 tok/s')).toBeTruthy()
    expect(screen.getByText('S1')).toBeTruthy()
    expect(screen.getByText('idle')).toBeTruthy()
    expect(screen.getByText('48%')).toBeTruthy()
    expect(screen.getByText(/#320167 · 140 tok\/s/)).toBeTruthy()

    act(() => {
      store.set({ ...store.getSnapshot(), enabled: false })
    })
    expect(screen.queryByText(/DeepSeek V4 Flash/)).toBeNull()
  })
})
