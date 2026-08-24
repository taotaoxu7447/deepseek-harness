/**
 * V4MonitorDock: real-time dual-slot cluster performance strip mounted on 'conversation.input.dock'.
 */

import { useId, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { V4SlotStateView, V4SlotView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { V4MonitorDockFace } from './v4-monitor-controller.ts'
import type {} from './locales.ts'
import css from './V4MonitorDock.module.css'

export type V4MonitorDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'v4Monitor'>
  & InjectFace<V4MonitorDockFace>

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

function slotPillClass(state: V4SlotStateView): string {
  switch (state) {
    case 'decoding': return css.slotPillDecode ?? ''
    case 'prefilling': return css.slotPillPrefill ?? ''
    default: return css.slotPillIdle ?? ''
  }
}

function compactSlotLabel(slot: V4SlotView, t: PropsLocale<'v4Monitor'>['t']): string {
  if (slot.state === 'decoding') return t('v4CompactDecoding', { tps: slot.decode_tps.toFixed(0) })
  if (slot.state === 'prefilling') return t('v4CompactPrefilling', {
    progress: Math.round(slot.prefill_progress * 100),
  })
  return t('v4CompactIdle')
}

function renderCompactSlot(slot: V4SlotView, t: PropsLocale<'v4Monitor'>['t']): ReactNode {
  const ctxPercent = Math.min(100, Math.round(slot.ctx_usage * 100))
  const meter = slot.state === 'prefilling'
    ? Math.min(100, Math.round(slot.prefill_progress * 100))
    : ctxPercent
  return (
    <span key={slot.id} className={css.compactChip} data-state={slot.state}>
      <span className={css.compactPulse} aria-hidden="true" />
      <span className={css.compactId}>S{slot.id}</span>
      <span className={css.compactMeter} aria-hidden="true">
        <span className={css.compactFill} style={{ width: `${meter}%` }} />
      </span>
      <span className={css.compactRate}>{compactSlotLabel(slot, t)}</span>
      <span className={css.compactCtx}>{ctxPercent}%</span>
    </span>
  )
}

function statusLabel(
  connected: boolean,
  isStale: boolean,
  pollIntervalMs: number,
  t: PropsLocale<'v4Monitor'>['t'],
): string {
  if (!connected) return t('v4Disconnected')
  if (isStale) return t('v4StaleWarning')
  return t('v4PollingStatus', { interval: (pollIntervalMs / 1000).toFixed(0) })
}

function renderSlotCard(slot: V4SlotView, t: PropsLocale<'v4Monitor'>['t']): ReactNode {
  const percent = Math.min(100, Math.round(slot.ctx_usage * 100))
  let stateText = t('v4Idle')
  if (slot.state === 'decoding') {
    stateText = t('v4Decoding', { tps: slot.decode_tps.toFixed(1) })
  } else if (slot.state === 'prefilling') {
    stateText = t('v4Prefilling', {
      progress: Math.round(slot.prefill_progress * 100),
      tps: Math.round(slot.prefill_tps),
    })
  }

  return (
    <div key={slot.id} className={css.slotCard}>
      <div className={css.slotHead}>
        <span className={css.slotTitle}>{t('v4Slot', { id: slot.id })}</span>
        <span className={slotPillClass(slot.state)}>{stateText}</span>
      </div>
      <div className={css.slotMetrics}>
        <span>{t('v4CtxUsage', {
          used: formatTokens(slot.prompt_tokens),
          total: formatTokens(slot.n_ctx),
          percent,
        })}</span>
      </div>
      <div className={css.progressBarContainer}>
        <div className={css.progressBarFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/**
 * Render the V4 cluster monitor dock, or nothing when the sidebar toggle is off.
 * @param props - Slot runtime, locale, and injected dock face.
 * @returns Dock strip, or null when hidden.
 */
export function V4MonitorDock(props: V4MonitorDockProps) {
  const { t, useV4Dock, toggleCollapse } = props
  const dockState = useV4Dock(snapshot => snapshot)
  const detailsId = useId()

  if (!dockState.enabled) {
    return null
  }

  const { data, collapsed, pollIntervalMs } = dockState
  const slots = data?.slots ?? []
  const lastTask = data?.history[0]
  const isStale = data?.stale === true
  const connected = data !== null
  const status = statusLabel(connected, isStale, pollIntervalMs, t)

  return (
    <section className={css.dock} data-v4-monitor-dock="" aria-label={t('v4DockTitle')}>
      <div className={css.panel}>
        <button
          type="button"
          className={css.summary}
          onClick={toggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={detailsId}
          aria-label={collapsed ? t('v4Expand') : t('v4Collapse')}
        >
          <span className={css.headerLeft}>
            <span className={css.modelBadge}>{t('v4DockTitle')}</span>
            <span className={connected ? css.tagLocal : css.tagOffline}>
              {connected ? t('v4LocalTag') : t('v4Disconnected')}
            </span>
          </span>
          {collapsed ? (
            <span className={css.compactSlots}>
              {slots.map(slot => renderCompactSlot(slot, t))}
              {lastTask ? (
                <span className={css.compactLast}>
                  #{lastTask.task} · {lastTask.decode_tps_avg.toFixed(0)} tok/s
                </span>
              ) : null}
            </span>
          ) : (
            <span className={css.headerRight}>
              <span className={css.statusIndicator}>
                <span className={!connected || isStale ? css.pulseDotStale : css.pulseDot} aria-hidden="true" />
                {status}
              </span>
            </span>
          )}
          <span className={css.chevron} aria-hidden="true">
            {collapsed ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
          </span>
        </button>
        {!collapsed && (
          <div id={detailsId} className={css.details}>
            <div className={css.slotsGrid}>
              {slots.map(slot => renderSlotCard(slot, t))}
            </div>
            <div className={css.metaRow}>
              <span>{t('v4Speculative')}</span>
              {lastTask ? (
                <span>{t('v4LastTask', {
                  task: lastTask.task,
                  tokens: lastTask.decoded,
                  tps: lastTask.decode_tps_avg.toFixed(1),
                  duration: lastTask.duration_s.toFixed(1),
                })}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default V4MonitorDock
