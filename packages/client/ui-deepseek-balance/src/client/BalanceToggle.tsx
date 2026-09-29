/**
 * Sidebar footer toggle that shows or hides the official API balance capsule.
 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { BalanceToggleFace } from './balance-controller.ts'
import type {} from './locales.ts'
import css from './BalanceToggle.module.css'

/** Props composed by the sidebar footer-action slot. */
export type BalanceToggleProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'deepseekBalance'>
  & InjectFace<BalanceToggleFace>

/**
 * Render the sidebar footer trigger that toggles the composer balance capsule.
 * @param props - Column geometry, locale copy, and the controller face.
 * @returns The trigger button.
 */
export function BalanceToggle(props: BalanceToggleProps): ReactNode {
  const { wide, t, useBalance, toggleEnabled } = props
  const enabled = useBalance(snapshot => snapshot.enabled)
  const glyph = wide ? 16 : 18

  return (
    <div className={clsx(css.layer, !wide && css.rail)}>
      <Tooltip label={t('balanceToggleTitle')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.trigger, enabled && css.triggerOn)}
          aria-label={t('balanceToggleLabel')}
          aria-pressed={enabled}
          onClick={() => { toggleEnabled() }}
        >
          <svg width={glyph} height={glyph} viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <text
              x="8"
              y="11"
              textAnchor="middle"
              fill="currentColor"
              fontSize="8"
              fontWeight="700"
              fontFamily="system-ui, sans-serif"
            >¥</text>
          </svg>
          {wide && <span className={css.triggerLabel}>{t('balanceToggleLabel')}</span>}
        </button>
      </Tooltip>
    </div>
  )
}

export default BalanceToggle
