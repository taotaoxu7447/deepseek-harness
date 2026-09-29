import { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeepSeekBalanceService, {
  DEFAULT_API_KEY_ENV,
  OFFICIAL_BASE_URL,
  clearBalanceHistory,
  computeConsumption,
  getPeakValleyStatus,
  loadBalanceHistory,
  saveBalanceHistory,
  type BalanceRecord,
} from '../src/index.ts'

const OFFICIAL_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '1.25', granted_balance: '0.00', topped_up_balance: '1.25' },
    { currency: 'CNY', total_balance: '88.50', granted_balance: '0.00', topped_up_balance: '88.50' },
  ],
}

function credentials(value?: string) {
  return {
    resolve: vi.fn(async (ref: CredentialRef) => {
      if (value === undefined || value.length === 0) return undefined
      expect(ref).toBe(credentialRef(DEFAULT_API_KEY_ENV))
      return { value, source: 'file' }
    }),
  }
}

describe('getPeakValleyStatus', () => {
  it('returns valley status all day on weekends (Saturday & Sunday)', () => {
    // 2026-08-22 is Saturday
    const satMorning = new Date('2026-08-22T10:00:00+08:00')
    expect(getPeakValleyStatus(satMorning)).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })

    // 2026-08-23 is Sunday
    const sunAfternoon = new Date('2026-08-23T15:00:00+08:00')
    expect(getPeakValleyStatus(sunAfternoon)).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
  })

  it('returns peak status during weekday morning peak (09:00-12:00 UTC+8)', () => {
    // 2026-08-24 is Monday
    const date = new Date('2026-08-24T10:00:00+08:00')
    expect(getPeakValleyStatus(date)).toEqual({
      period: 'peak',
      periodLabel: '梁文峰',
    })
  })

  it('returns valley status during weekday lunch break (12:00-14:00 UTC+8)', () => {
    const date = new Date('2026-08-24T13:00:00+08:00')
    expect(getPeakValleyStatus(date)).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
  })

  it('returns peak status during weekday afternoon peak (14:00-18:00 UTC+8)', () => {
    const date = new Date('2026-08-24T15:30:00+08:00')
    expect(getPeakValleyStatus(date)).toEqual({
      period: 'peak',
      periodLabel: '梁文峰',
    })
  })

  it('returns valley status during weekday night and early morning', () => {
    const earlyMorning = new Date('2026-08-24T03:00:00+08:00')
    expect(getPeakValleyStatus(earlyMorning)).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })

    const night = new Date('2026-08-24T20:00:00+08:00')
    expect(getPeakValleyStatus(night)).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
  })

  it('handles weekday peak boundary times correctly', () => {
    // 09:00:00 (start of morning peak)
    expect(getPeakValleyStatus(new Date('2026-08-24T09:00:00+08:00'))).toEqual({
      period: 'peak',
      periodLabel: '梁文峰',
    })
    // 08:59:59 (just before morning peak)
    expect(getPeakValleyStatus(new Date('2026-08-24T08:59:59+08:00'))).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
    // 12:00:00 (end of morning peak -> valley)
    expect(getPeakValleyStatus(new Date('2026-08-24T12:00:00+08:00'))).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
    // 14:00:00 (start of afternoon peak)
    expect(getPeakValleyStatus(new Date('2026-08-24T14:00:00+08:00'))).toEqual({
      period: 'peak',
      periodLabel: '梁文峰',
    })
    // 18:00:00 (end of afternoon peak -> valley)
    expect(getPeakValleyStatus(new Date('2026-08-24T18:00:00+08:00'))).toEqual({
      period: 'valley',
      periodLabel: '梁文谷',
    })
  })

  it('defaults to current time when no date is passed', () => {
    const status = getPeakValleyStatus()
    expect(['peak', 'valley']).toContain(status.period)
    expect(['梁文峰', '梁文谷']).toContain(status.periodLabel)
  })
})

describe('computeConsumption', () => {
  it('returns empty arrays when records are empty or single item', () => {
    expect(computeConsumption([])).toEqual({ daily: [], monthly: [] })
    expect(computeConsumption([{ timestamp: Date.now(), total: 100, currency: 'CNY' }])).toEqual({
      daily: [],
      monthly: [],
    })
  })

  it('aggregates across multiple days and months in UTC+8', () => {
    // 2026-07-31 23:00 UTC+8 (timestamp in ms)
    const t1 = new Date('2026-07-31T23:00:00+08:00').getTime()
    // 2026-08-01 01:00 UTC+8
    const t2 = new Date('2026-08-01T01:00:00+08:00').getTime()
    // 2026-08-01 12:00 UTC+8
    const t3 = new Date('2026-08-01T12:00:00+08:00').getTime()
    // 2026-08-02 10:00 UTC+8
    const t4 = new Date('2026-08-02T10:00:00+08:00').getTime()

    const records: BalanceRecord[] = [
      { timestamp: t1, total: 100, currency: 'CNY' },
      { timestamp: t2, total: 90, currency: 'CNY' }, // 10 consumed on 2026-08-01
      { timestamp: t3, total: 85, currency: 'CNY' }, // 5 consumed on 2026-08-01
      { timestamp: t4, total: 70, currency: 'CNY' }, // 15 consumed on 2026-08-02
    ]

    const result = computeConsumption(records)
    expect(result.daily).toEqual([
      { key: '2026-08-01', label: '8/1', amount: 15 },
      { key: '2026-08-02', label: '8/2', amount: 15 },
    ])
    expect(result.monthly).toEqual([{ key: '2026-08', label: '8月', amount: 30 }])
  })

  it('ignores balance increases or currency changes', () => {
    const t1 = new Date('2026-08-20T10:00:00+08:00').getTime()
    const t2 = new Date('2026-08-20T11:00:00+08:00').getTime()
    const t3 = new Date('2026-08-20T12:00:00+08:00').getTime()
    const t4 = new Date('2026-08-20T13:00:00+08:00').getTime()

    const records: BalanceRecord[] = [
      { timestamp: t1, total: 50, currency: 'CNY' },
      { timestamp: t2, total: 150, currency: 'CNY' }, // Recharge: delta ignored
      { timestamp: t3, total: 10, currency: 'USD' }, // Currency changed: ignored
      { timestamp: t4, total: 8, currency: 'USD' }, // 2 consumed in USD
    ]

    const result = computeConsumption(records)
    expect(result.daily).toEqual([{ key: '2026-08-20', label: '8/20', amount: 2 }])
    expect(result.monthly).toEqual([{ key: '2026-08', label: '8月', amount: 2 }])
  })
})

describe('loadBalanceHistory & saveBalanceHistory', () => {
  beforeEach(() => {
    clearBalanceHistory()
  })

  it('loads and saves in-memory records fallback', () => {
    expect(loadBalanceHistory()).toEqual([])
    const records = [{ timestamp: 1234567, total: 50, currency: 'CNY' }]
    saveBalanceHistory(records)
    expect(loadBalanceHistory()).toEqual(records)
  })
})

describe('DeepSeekBalanceService', () => {
  beforeEach(() => {
    clearBalanceHistory()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults the capsule on', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials('sk-test') as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()
    expect(ctx.deepseekBalance.config.enabled).toBe(true)
  })

  it('does not fetch without an official API key', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials() as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await ctx.deepseekBalance.fetchBalance(true)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches official /user/balance with the stored DeepSeek key and includes period and consumption', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials('sk-test') as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(OFFICIAL_BODY),
    } as unknown as Response)

    const balance = await ctx.deepseekBalance.fetchBalance(true)
    expect(balance).toMatchObject({
      currency: 'CNY',
      total: '88.50',
      available: true,
    })
    expect(balance?.period).toBeDefined()
    expect(balance?.periodLabel).toBeDefined()
    expect(balance?.consumption).toBeDefined()
    expect(Array.isArray(balance?.consumption.daily)).toBe(true)
    expect(Array.isArray(balance?.consumption.monthly)).toBe(true)

    expect(fetchSpy).toHaveBeenCalledWith(
      `${OFFICIAL_BASE_URL}/user/balance`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test',
        }),
      }),
    )
  })

  it('calculates consumption deltas across successive balance updates and ignores top-ups', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials('sk-test') as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()

    // 1st fetch: balance 100.00
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '100.00' }],
        }),
    } as unknown as Response)

    const b1 = await ctx.deepseekBalance.fetchBalance(true)
    expect(b1?.total).toBe('100.00')
    expect(b1?.consumption.daily).toEqual([])
    expect(b1?.consumption.monthly).toEqual([])

    // 2nd fetch: balance 95.50 (consumption delta 4.50)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '95.50' }],
        }),
    } as unknown as Response)

    const b2 = await ctx.deepseekBalance.fetchBalance(true)
    expect(b2?.total).toBe('95.50')
    expect(b2?.consumption.daily.length).toBe(1)
    expect(b2?.consumption.daily[0]?.amount).toBe(4.5)
    expect(b2?.consumption.monthly.length).toBe(1)
    expect(b2?.consumption.monthly[0]?.amount).toBe(4.5)

    // 3rd fetch: top-up to 200.00 (delta <= 0, no consumption added)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '200.00' }],
        }),
    } as unknown as Response)

    const b3 = await ctx.deepseekBalance.fetchBalance(true)
    expect(b3?.total).toBe('200.00')
    expect(b3?.consumption.daily.length).toBe(1)
    expect(b3?.consumption.daily[0]?.amount).toBe(4.5)
    expect(b3?.consumption.monthly.length).toBe(1)
    expect(b3?.consumption.monthly[0]?.amount).toBe(4.5)

    // 4th fetch: balance 190.00 (consumption delta 10.00, total = 14.50)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '190.00' }],
        }),
    } as unknown as Response)

    const b4 = await ctx.deepseekBalance.fetchBalance(true)
    expect(b4?.total).toBe('190.00')
    expect(b4?.consumption.daily.length).toBe(1)
    expect(b4?.consumption.daily[0]?.amount).toBe(14.5)
    expect(b4?.consumption.monthly.length).toBe(1)
    expect(b4?.consumption.monthly[0]?.amount).toBe(14.5)
  })

  it('keeps the last good snapshot when the official API fails', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials('sk-test') as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(OFFICIAL_BODY),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error('network down'))

    expect(await ctx.deepseekBalance.fetchBalance(true)).toMatchObject({ total: '88.50' })
    expect(await ctx.deepseekBalance.fetchBalance(true)).toMatchObject({ total: '88.50' })
  })
})
