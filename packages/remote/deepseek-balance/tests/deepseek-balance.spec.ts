import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeepSeekBalanceService, { DEFAULT_API_KEY_ENV, OFFICIAL_BASE_URL } from '../src/index.ts'

const OFFICIAL_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '1.25', granted_balance: '0.00', topped_up_balance: '1.25' },
    { currency: 'CNY', total_balance: '88.50', granted_balance: '0.00', topped_up_balance: '88.50' },
  ],
}

function credentials(value?: string) {
  return {
    resolve: vi.fn(async (ref: ReturnType<typeof credentialRef>) => {
      if (value === undefined || value.length === 0) return undefined
      expect(ref).toBe(credentialRef(DEFAULT_API_KEY_ENV))
      return { value, source: 'file' }
    }),
  }
}

describe('DeepSeekBalanceService', () => {
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

  it('fetches official /user/balance with the stored DeepSeek key', async () => {
    const ctx = new Context()
    ctx.provide('credentials', credentials('sk-test') as never)
    await ctx.plugin(DeepSeekBalanceService, {}).await()

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(OFFICIAL_BODY),
    } as unknown as Response)

    expect(await ctx.deepseekBalance.fetchBalance(true)).toEqual({
      currency: 'CNY',
      total: '88.50',
      available: true,
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      `${OFFICIAL_BASE_URL}/user/balance`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test',
        }),
      }),
    )
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
