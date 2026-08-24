/** Official DeepSeek API account balance snapshot. */

/** One currency row from GET /user/balance. */
export interface DeepSeekBalance {
  /** ISO-ish currency code returned by the official API (`CNY` or `USD`). */
  currency: string
  /** Total available balance, including granted and topped-up amounts. */
  total: string
  /** Whether the official API reports the balance as sufficient for calls. */
  available: boolean
}
