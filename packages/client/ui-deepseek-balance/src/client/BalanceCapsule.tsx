/**
 * Composer capsule showing the official DeepSeek API account balance.
 */

import { type ReactNode, useRef, useState } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceCapsuleFace } from './balance-controller.ts'
import { formatBalance } from './balance-controller.ts'
import type {} from './locales.ts'
import { ConsumptionPopover } from './ConsumptionPopover.tsx'
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
  const { enabled, balance } = useBalance(snapshot => snapshot)
  const data = balance
  const [isOpen, setIsOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)

  if (!enabled || data === null) return null

  const amount = formatBalance(data)
  const period = data.period ?? 'peak'
  const periodLabel = data.periodLabel || (period === 'peak' ? t('periodPeak') : t('periodValley'))

  return (
    <div className={css.wrapper}>
      <button
        ref={chipRef}
        type="button"
        className={clsx(css.chip, period === 'peak' ? css.peak : css.valley)}
        data-deepseek-balance=""
        data-period={period}
        aria-label={t('balanceCapsuleLabel', { amount })}
        title={t('balanceCapsuleLabel', { amount })}
        onClick={() => setIsOpen(open => !open)}
      >
        <span className={css.period}>{periodLabel}</span>
        <span className={css.amount}>{amount}</span>
      </button>
      {isOpen && (
        <ConsumptionPopover
          consumption={data.consumption}
          currency={data.currency}
          onClose={() => setIsOpen(false)}
          t={t}
          anchorRef={chipRef}
        />
      )}
    </div>
  )
}

export default BalanceCapsule
