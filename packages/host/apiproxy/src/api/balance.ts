/**
 * balance domain contract: official DeepSeek API account balance.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Time-of-day balance pricing period: peak hours (梁文峰) or valley hours (梁文谷). */
export type BalancePeriod = 'peak' | 'valley'

/** Aggregated consumption data item for chart visualization. */
export interface ConsumptionItem {
  /** Bucket key: 'YYYY-MM-DD' for daily or 'YYYY-MM' for monthly. */
  key: string
  /** Display label: 'M/D' for daily or 'M月' for monthly. */
  label: string
  /** Consumed currency amount in this interval. */
  amount: number
}

/** Grouped consumption data for daily and monthly trends. */
export interface ConsumptionData {
  daily: ConsumptionItem[]
  monthly: ConsumptionItem[]
}

/** Official DeepSeek API account balance snapshot. */
export interface BalanceView {
  /** ISO-ish currency code returned by the official API (`CNY` or `USD`). */
  currency: string
  /** Total available balance, including granted and topped-up amounts. */
  total: string
  /** Whether the official API reports the balance as sufficient for calls. */
  available: boolean
  /** Time-of-day pricing period ('peak' or 'valley'). */
  period: BalancePeriod
  /** Localized display label for the pricing period ('梁文峰' or '梁文谷'). */
  periodLabel: string
  /** Aggregated daily and monthly consumption history. */
  consumption: ConsumptionData
}

/** balance unary methods. */
export interface BalanceApi {
  /**
   * Fetch the current official DeepSeek API account balance.
   * @param request - optional force-refresh flag.
   */
  get(request: RpcRequest<{ force?: boolean }>): Promise<RpcResponse<{ balance: BalanceView | null }>>
}
