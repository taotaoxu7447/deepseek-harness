import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import V4MonitorService, { DEFAULT_MONITOR_URL } from '../src/index.ts'
import type { V4MonitorState } from '../src/types.ts'

const MOCK_STATE: V4MonitorState = {
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
      prefill_progress: 0.0,
      prefill_tps: 0,
      decode_tps: 142.5,
      decoded: 120,
      n_remain: -1,
      ctx_usage: 0.4759,
      speculative: true,
      params: { temp: 1.0, top_p: 0.95, max_tokens: 8192 },
    },
  ],
  history: [],
  age_s: 1.3,
  stale: false,
}

describe('V4MonitorService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with the dock off and no connection settings', async () => {
    const ctx = new Context()
    await ctx.plugin(V4MonitorService, {}).await()

    expect(ctx.v4Monitor).toBeTruthy()
    expect(ctx.v4Monitor.config.enabled).toBe(false)
    expect(ctx.v4Monitor.config.monitorUrl).toBe(DEFAULT_MONITOR_URL)
    expect(ctx.v4Monitor.config.passcode ?? '').toBe('')
  })

  it('does not fetch until both monitor address and invite code are configured', async () => {
    const noPasscode = new Context()
    await noPasscode.plugin(V4MonitorService, { monitorUrl: 'https://monitor.example' }).await()
    const noMonitor = new Context()
    await noMonitor.plugin(V4MonitorService, { passcode: 'test-pass' }).await()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await noPasscode.v4Monitor.fetchState(true)).toBeNull()
    expect(await noMonitor.v4Monitor.fetchState(true)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches live cluster state from ds-dash endpoint with passcode header', async () => {
    const ctx = new Context()
    await ctx.plugin(V4MonitorService, {
      monitorUrl: 'https://64.90.8.184:9445',
      passcode: 'test-pass',
    }).await()

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_STATE),
    } as unknown as Response)

    const state = await ctx.v4Monitor.fetchState(true)
    expect(state).toEqual(MOCK_STATE)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const request = fetchSpy.mock.calls[0]
    expect(request?.[0]).toBe('https://64.90.8.184:9445/ds-dash/api/state')
    expect(request?.[1]?.headers).toEqual({
      'X-Dash-Pass': 'test-pass',
      'Accept': 'application/json',
    })
  })

  it('returns cached state when fetch fails', async () => {
    const ctx = new Context()
    await ctx.plugin(V4MonitorService, {
      monitorUrl: 'https://monitor.example',
      passcode: 'test-pass',
    }).await()

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_STATE),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('network down'))

    const state1 = await ctx.v4Monitor.fetchState(true)
    expect(state1).toEqual(MOCK_STATE)

    const state2 = await ctx.v4Monitor.fetchState(true)
    expect(state2?.stale).toBe(true)
  })
})
