/**
 * balance domain contract: official DeepSeek API account balance.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Official DeepSeek API account balance snapshot. */
export interface BalanceView {
  /** ISO-ish currency code returned by the official API (`CNY` or `USD`). */
  currency: string
  /** Total available balance, including granted and topped-up amounts. */
  total: string
  /** Whether the official API reports the balance as sufficient for calls. */
  available: boolean
}

/** balance unary methods. */
export interface BalanceApi {
  /**
   * Fetch the current official DeepSeek API account balance.
   * @param request - optional force-refresh flag.
   */
  get(request: RpcRequest<{ force?: boolean }>): Promise<RpcResponse<{ balance: BalanceView | null }>>
}
