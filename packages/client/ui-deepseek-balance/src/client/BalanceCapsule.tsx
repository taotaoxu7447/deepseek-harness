/**
 * Composer capsule showing the official DeepSeek API account balance.
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceCapsuleFace } from './balance-controller.ts'
import { formatBalance } from './balance-controller.ts'
import type {} from './locales.ts'
import css from './BalanceCapsule.module.css'

/** Props composed by the composer right-input list slot. */
export type BalanceCapsuleProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'deepseekBalance'>
  & InjectFace<BalanceCapsuleFace>

/**
 * Render the official-API balance chip immediately left of the model capsule.
 * @param props - Slot runtime, locale, and injected balance face.
 * @returns The chip, or null when the toggle is off or no balance is known.
 */
export function BalanceCapsule(props: BalanceCapsuleProps): ReactNode {
  const { t, useBalance } = props
  const { enabled, data } = useBalance(snapshot => snapshot)
  if (!enabled || data === null) return null

  const amount = formatBalance(data)
  return (
    <span
      className={css.chip}
      data-deepseek-balance=""
      aria-label={t('balanceCapsuleLabel', { amount })}
      title={t('balanceCapsuleLabel', { amount })}
    >
      <span className={css.amount}>{amount}</span>
    </span>
  )
}

export default BalanceCapsule
