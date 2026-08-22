/**
 * The Remote card: the roster of dsh hosts reachable through SSH tunnels, and
 * the live tunnel beside each row. Editing is staged like every plugin card —
 * Save writes the whole `devices` list — while connect/disconnect act
 * immediately and the status pill follows the Host's own phase. A ready row
 * offers its tunneled UI two ways: a new tab (the browser path) and this
 * window (the macOS shell's WKWebView follows neither `target=_blank` nor a
 * bare link, so it gets an explicit in-place navigation).
 */

import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { RemoteCardFace, RemoteCardState, RemoteDeviceRow, RemoteTunnelState } from './remote-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './fields.module.css'
import rowCss from './RemoteCard.module.css'

/** Props the renderer binds for the remote card. */
export type RemoteCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<RemoteCardFace>

/** What one rendered device row needs beside the card's bound props. */
interface RemoteRowView {
  t: PropsLocale<'settings.plugins'>['t']
  face: Omit<RemoteCardFace, 'hooks'>
  state: RemoteCardState
  index: number
  /** The row this view renders, yielded by the roster map. */
  row: RemoteDeviceRow
  /** The Host's live tunnel state for this row, when the poll has answered. */
  tunnel: RemoteTunnelState | undefined
}

/** The status pill beside one row's head. */
function tunnelPill(view: RemoteRowView): ReactNode {
  const { t, tunnel } = view
  if (tunnel === undefined) return <span className={rowCss.pillMuted}>{t('remoteStateUnknown')}</span>
  switch (tunnel.tunnel) {
    case 'ready':
      return <span className={rowCss.pillReady}>{t('remoteStateReady')}</span>
    case 'connecting':
      return <span className={rowCss.pillWorking}>{t('remoteStateConnecting')}</span>
    case 'failed':
      return <span className={rowCss.pillFailed}>{t('remoteStateFailed')}</span>
    default:
      return <span className={rowCss.pillMuted}>{t('remoteStateDisconnected')}</span>
  }
}

/** The live-tunnel controls beside one row's head: the verb, then the ready actions. */
function tunnelControls(view: RemoteRowView): ReactNode {
  const { t, face, index, tunnel } = view
  const live = tunnel?.tunnel === 'connecting' || tunnel?.tunnel === 'ready'
  return (
    <span className={css.badges}>
      {tunnel?.tunnel === 'ready' && tunnel.url !== undefined
        ? (
          <>
            <a className={rowCss.open} href={tunnel.url} target="_blank" rel="noopener noreferrer">
              {t('remoteOpenExternal')}
            </a>
            <button type="button" className={css.reset} onClick={() => { face.openHere(index) }}>
              {t('remoteOpenHere')}
            </button>
          </>
        )
        : null}
      <button
        type="button"
        className={css.reset}
        onClick={() => {
          if (live) face.disconnect(index)
          else face.connect(index)
        }}
      >{live ? t('remoteDisconnect') : t('remoteConnect')}</button>
    </span>
  )
}

/** Render one roster row of the staged list. */
function remoteRow(view: RemoteRowView): ReactNode {
  const { t, face, state, index, row, tunnel } = view
  const disabled = !state.writable
  return (
    <div className={rowCss.row} role="group" aria-label={row.id}>
      <div className={rowCss.rowHead}>
        <span className={rowCss.title}>
          {row.label !== undefined && row.label !== '' ? row.label : row.id}
          {row.label !== undefined && row.label !== '' ? <span className={rowCss.titleId}> · {row.id}</span> : null}
        </span>
        {tunnelPill(view)}
        <span className={css.badges}>
          <button type="button" className={css.reset} disabled={disabled}
            onClick={() => { face.removeRow(index) }}>{t('visionRemove')}</button>
        </span>
        {tunnelControls(view)}
      </div>
      {tunnel?.detail !== undefined ? <p className={rowCss.detail} role="status">{tunnel.detail}</p> : null}
      <div className={rowCss.rowBody}>
        <ValueField
          id={`remote-row-${index}-id`}
          label={t('remoteId')}
          hint={t('remoteIdHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          text={row.id}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'id', text) }}
        />
        <ValueField
          id={`remote-row-${index}-label`}
          label={t('remoteLabel')}
          hint={t('remoteLabelHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          text={row.label ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'label', text) }}
        />
        <ValueField
          id={`remote-row-${index}-target`}
          label={t('remoteSshTarget')}
          hint={t('remoteSshTargetHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          text={row.sshTarget ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'sshTarget', text) }}
        />
        <ValueField
          id={`remote-row-${index}-remote-port`}
          label={t('remoteRemotePort')}
          hint={t('remoteRemotePortHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          numeric
          text={state.rowPorts[index]?.remotePort ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRowPort(index, 'remotePort', text) }}
        />
        <ValueField
          id={`remote-row-${index}-local-port`}
          label={t('remoteLocalPort')}
          hint={t('remoteLocalPortHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          numeric
          text={state.rowPorts[index]?.localPort ?? ''}
          invalid={false}
          overridden={false}
          onEdit={(text) => { face.editRowPort(index, 'localPort', text) }}
        />
        <ToggleField
          id={`remote-row-${index}-auto-connect`}
          label={t('remoteAutoConnect')}
          hint={t('remoteAutoConnectHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          disabled={disabled}
          checked={row.autoConnect === true}
          overridden={false}
          onEdit={(text) => { face.editRow(index, 'autoConnect', text === 'on') }}
        />
      </div>
    </div>
  )
}

/**
 * Render the remote-devices card.
 * @param props - locale copy, the card snapshot, and its editor actions.
 * @returns the card.
 */
export function RemoteCard(props: RemoteCardProps) {
  const { t } = props
  const state = props.useRemoteCard(snapshot => snapshot)
  const face: Omit<RemoteCardFace, 'hooks'> = props
  const disabled = !state.writable
  // The poll belongs to the card being rendered: it starts on mount and stops
  // on unmount, so an absent card never keeps a timer alive.
  useEffect(() => {
    props.setPolling(true)
    return () => { props.setPolling(false) }
  }, [props])
  return (
    <PluginCard
      t={t}
      titleKey="remoteTitle"
      descriptionKey="remoteDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={rowCss.roster}>
        {state.rows.map((row, index) => (
          <div key={row.id}>
            {remoteRow({ t, face, state, index, row, tunnel: state.tunnels[index] })}
          </div>
        ))}
        {state.rows.length === 0 ? <p className={rowCss.detail}>{t('remoteEmpty')}</p> : null}
      </div>
      <div className={css.head}>
        <button type="button" className={css.reset} disabled={disabled}
          onClick={() => { props.addRow() }}>{t('remoteAddDevice')}</button>
      </div>
    </PluginCard>
  )
}
