/**
 * Sidebar footer toggle that shows or hides the composer V4 monitor dock.
 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconDataOutlineMedium, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { V4MonitorToggleFace } from './v4-monitor-controller.ts'
import type {} from './locales.ts'
import css from './V4MonitorToggle.module.css'

/** Props composed by the sidebar footer-action slot. */
export type V4MonitorToggleProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'v4Monitor'>
  & InjectFace<V4MonitorToggleFace>

/**
 * Render the sidebar footer trigger that toggles the composer monitor dock.
 * @param props - Column geometry, locale copy, and the controller face.
 * @returns The trigger button.
 */
export function V4MonitorToggle(props: V4MonitorToggleProps): ReactNode {
  const { wide, t, useV4Dock, toggleEnabled } = props
  const enabled = useV4Dock(snapshot => snapshot.enabled)

  return (
    <div className={clsx(css.layer, !wide && css.rail)}>
      <Tooltip label={t('v4ToggleTitle')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.trigger, enabled && css.triggerOn)}
          aria-label={t('v4ToggleLabel')}
          aria-pressed={enabled}
          onClick={() => { toggleEnabled() }}
        >
          <IconDataOutlineMedium size={wide ? 16 : 18} />
          {wide && <span className={css.triggerLabel}>{t('v4ToggleLabel')}</span>}
        </button>
      </Tooltip>
    </div>
  )
}

export default V4MonitorToggle
