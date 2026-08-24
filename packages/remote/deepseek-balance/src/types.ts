/** Official DeepSeek API account balance snapshot. */

/** Pricing period classification based on Beijing time (UTC+8). */
export type BalancePeriod = 'peak' | 'valley'

/** Single data point in daily or monthly consumption aggregation. */
export interface ConsumptionItem {
  /** Date key: 'YYYY-MM-DD' for daily or 'YYYY-MM' for monthly. */
  key: string
  /** Display label: 'M/D' for daily or 'M月' for monthly. */
  label: string
  /** Aggregated consumption amount. */
  amount: number
}

/** Aggregated consumption time-series data. */
export interface ConsumptionData {
  /** Daily consumption history (e.g. past 14/30 days). */
  daily: ConsumptionItem[]
  /** Monthly consumption history (e.g. past 12 months). */
  monthly: ConsumptionItem[]
}

/** One currency row from GET /user/balance. */
export interface DeepSeekBalance {
  /** ISO-ish currency code returned by the official API (`CNY` or `USD`). */
  currency: string
  /** Total available balance, including granted and topped-up amounts. */
  total: string
  /** Whether the official API reports the balance as sufficient for calls. */
  available: boolean
  /** Current pricing period: 'peak' or 'valley'. */
  period: BalancePeriod
  /** Period display label: '梁文峰' for peak, '梁文谷' for valley. */
  periodLabel: string
  /** Aggregated consumption data. */
  consumption: ConsumptionData
}

/** Balance record stored in history. */
export interface BalanceRecord {
  /** Timestamp in milliseconds. */
  timestamp: number
  /** Total balance recorded. */
  total: number
  /** Currency code. */
  currency: string
}

/** Historical snapshots file schema. */
export interface BalanceHistoryStore {
  records: BalanceRecord[]
}
