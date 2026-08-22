/** Official DeepSeek API balance capsule locale dictionary. */

/** Dictionary namespace identifier. */
export const NS = 'deepseekBalance'

/** Locale keys required by the balance capsule and sidebar toggle. */
export interface DeepSeekBalanceLocaleMap {
  balanceToggleLabel: string
  balanceToggleTitle: string
  balanceCapsuleLabel: string
}

/** Valid dictionary keys for the balance capsule. */
export type DeepSeekBalanceLocaleKey = keyof DeepSeekBalanceLocaleMap

/** English copy dictionary. */
export const en: Record<DeepSeekBalanceLocaleKey, string> = {
  balanceToggleLabel: 'Balance',
  balanceToggleTitle: 'Official API balance',
  balanceCapsuleLabel: 'DeepSeek balance {amount}',
}

/** Chinese copy dictionary. */
export const zh: Record<DeepSeekBalanceLocaleKey, string> = {
  balanceToggleLabel: '余额',
  balanceToggleTitle: '官方 API 余额',
  balanceCapsuleLabel: 'DeepSeek 余额 {amount}',
}

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    deepseekBalance: DeepSeekBalanceLocaleKey
  }
}
