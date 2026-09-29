/** Official DeepSeek API balance capsule locale dictionary. */

/** Dictionary namespace identifier. */
export const NS = 'deepseekBalance'

/** Locale keys required by the balance capsule and sidebar toggle. */
export interface DeepSeekBalanceLocaleMap {
  balanceToggleLabel: string
  balanceToggleTitle: string
  balanceCapsuleLabel: string
  periodPeak: string
  periodValley: string
  tabDaily: string
  tabMonthly: string
  noConsumption: string
  popoverTitle: string
}

/** Valid dictionary keys for the balance capsule. */
export type DeepSeekBalanceLocaleKey = keyof DeepSeekBalanceLocaleMap

/** English copy dictionary. */
export const en: Record<DeepSeekBalanceLocaleKey, string> = {
  balanceToggleLabel: 'Balance',
  balanceToggleTitle: 'Official API balance',
  balanceCapsuleLabel: 'DeepSeek balance {amount}',
  periodPeak: 'Peak',
  periodValley: 'Valley',
  tabDaily: 'Daily',
  tabMonthly: 'Monthly',
  noConsumption: 'No recent consumption records',
  popoverTitle: 'API Consumption Stats',
}

/** Chinese copy dictionary. */
export const zh: Record<DeepSeekBalanceLocaleKey, string> = {
  balanceToggleLabel: '余额',
  balanceToggleTitle: '官方 API 余额',
  balanceCapsuleLabel: 'DeepSeek 余额 {amount}',
  periodPeak: '梁文峰',
  periodValley: '梁文谷',
  tabDaily: '每日消费',
  tabMonthly: '每月消费',
  noConsumption: '暂无近期消费记录',
  popoverTitle: 'API 消费统计',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    deepseekBalance: DeepSeekBalanceLocaleKey
  }
}
