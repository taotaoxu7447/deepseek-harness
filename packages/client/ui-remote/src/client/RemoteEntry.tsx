/**
 * The sidebar-footer remote entry: a trigger row beside Settings that opens
 * the remote-device modal. The trigger carries a status dot while any tunnel
 * is live; the modal lists every configured device with its live phase, the
 * connect/disconnect verb, and — once ready — the two open gestures: stage
 * the remote UI as a window tab, or open it in a new browsing context (which
 * the macOS shell routes into its own app window). The add-device form at the
 * bottom extends the `remote` settings section.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconGlobeOutline14, IconRightUpOutline14, Input, Modal, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.footer.action') into
// this program so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  AddDeviceDraft, RemoteEntryDevice, RemoteEntryFace, RemoteTunnelPhase,
} from './remote-entry-controller.ts'
import { deviceLabel } from './remote-entry-controller.ts'
import type { RemoteEntryKey } from './locales.ts'
import css from './RemoteEntry.module.css'

/** Trigger + modal props composed by the sidebar footer-action slot. */
export type RemoteEntryProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<'remoteEntry'> & InjectFace<RemoteEntryFace>

type T = PropsLocale<'remoteEntry'>['t']

const PHASE_LABELS = {
  disconnected: 'state.disconnected',
  connecting: 'state.connecting',
  ready: 'state.ready',
  failed: 'state.failed',
} as const satisfies Record<RemoteTunnelPhase, RemoteEntryKey>

/** The trigger dot summarizes the live fleet; nothing shows while every tunnel rests. */
function fleetDot(devices: readonly RemoteEntryDevice[]): StateDotState | undefined {
  if (devices.some(device => device.tunnel === 'ready')) return 'done'
  if (devices.some(device => device.tunnel === 'connecting')) return 'ongoing'
  if (devices.some(device => device.tunnel === 'failed')) return 'error'
  return undefined
}

/** One roster row: name + phase pill, the tunnel detail, and the phase's actions. */
function DeviceRow({ t, device, busy, face }: {
  t: T
  device: RemoteEntryDevice
  busy: boolean
  face: Omit<RemoteEntryFace, 'hooks'>
}): ReactNode {
  const live = device.tunnel === 'connecting' || device.tunnel === 'ready'
  return (
    <li className={css.row} data-remote-row={device.id}>
      <div className={css.rowHead}>
        <span className={css.rowTitle}>{deviceLabel(device)}</span>
        <span className={css.pill} data-phase={device.tunnel}>{t(PHASE_LABELS[device.tunnel])}</span>
      </div>
      <div className={css.rowMeta}>{device.sshTarget}</div>
      {device.detail !== undefined && device.tunnel === 'failed' && (
        <p className={css.rowDetail} role="status">{device.detail}</p>
      )}
      <div className={css.rowActions}>
        {device.tunnel === 'ready' && device.url !== undefined && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title={t('action.openTab.title')}
              onClick={() => { face.openHere(device.id) }}
            >{t('action.openTab')}</Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              icon={<IconRightUpOutline14 size={14} />}
              title={t('action.openWindow.title')}
              onClick={() => { face.openExternal(device.id) }}
            >{t('action.openWindow')}</Button>
          </>
        )}
        <Button
          size="sm"
          variant={live ? 'ghost' : 'primary'}
          disabled={busy}
          onClick={() => {
            if (live) face.disconnect(device.id)
            else face.connect(device.id)
          }}
        >{live ? t('action.disconnect') : t('action.connect')}</Button>
      </div>
    </li>
  )
}

const BLANK_DRAFT: AddDeviceDraft = {
  label: '',
  sshTarget: '',
  remotePort: '',
  localPort: '',
  autoConnect: true,
}

/** The add-device form staged inside the modal; the controller validates on submit. */
function AddDeviceForm({ t, face, failure, onDone }: {
  t: T
  face: Omit<RemoteEntryFace, 'hooks'>
  failure: string | undefined
  onDone: () => void
}): ReactNode {
  const [draft, setDraft] = useState<AddDeviceDraft>(BLANK_DRAFT)
  const edit = (patch: Partial<AddDeviceDraft>): void => {
    setDraft(current => ({ ...current, ...patch }))
  }
  return (
    <form
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault()
        face.addDevice(draft)
      }}
    >
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('add.label')}</span>
        <Input
          value={draft.label}
          placeholder={t('add.label.placeholder')}
          onChange={(event) => { edit({ label: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('add.sshTarget')}</span>
        <Input
          value={draft.sshTarget}
          placeholder={t('add.sshTarget.placeholder')}
          required
          onChange={(event) => { edit({ sshTarget: event.target.value }) }}
        />
      </label>
      <div className={css.fieldPair}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('add.remotePort')}</span>
          <Input
            value={draft.remotePort}
            placeholder={t('add.remotePort.placeholder')}
            inputMode="numeric"
            onChange={(event) => { edit({ remotePort: event.target.value }) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('add.localPort')}</span>
          <Input
            value={draft.localPort}
            placeholder={t('add.localPort.placeholder')}
            inputMode="numeric"
            onChange={(event) => { edit({ localPort: event.target.value }) }}
          />
        </label>
      </div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={draft.autoConnect}
          onChange={(event) => { edit({ autoConnect: event.target.checked }) }}
        />
        <span>{t('add.autoConnect')}</span>
      </label>
      {failure !== undefined && (
        <p className={css.failure} role="alert">{t(failure as RemoteEntryKey)}</p>
      )}
      <div className={css.formActions}>
        <Button size="sm" variant="ghost" onClick={onDone}>{t('add.cancel')}</Button>
        <Button size="sm" variant="primary" type="submit">{t('add.submit')}</Button>
      </div>
    </form>
  )
}

/**
 * Render the sidebar footer trigger and, while open, the remote-device modal.
 * @param props - owner geometry, locale copy, and the controller's injected face.
 * @returns the entry tree.
 */
export function RemoteEntry(props: RemoteEntryProps): ReactNode {
  const { wide, t, useRemoteEntry } = props
  const face: Omit<RemoteEntryFace, 'hooks'> = props
  const state = useRemoteEntry(snapshot => snapshot)
  const dot = fleetDot(state.devices)

  return (
    <div className={clsx(css.layer, !wide && css.rail)}>
      <Tooltip label={t('trigger.title')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.trigger}
          aria-label={t('trigger.label')}
          aria-expanded={state.open}
          onClick={() => { face.setOpen(true) }}
        >
          <IconGlobeOutline14 size={wide ? 16 : 18} />
          {wide && <span className={css.triggerLabel}>{t('trigger.label')}</span>}
          {dot !== undefined && <StateDot state={dot} size={8} className={css.triggerDot} />}
        </button>
      </Tooltip>
      <Modal
        open={state.open}
        onClose={() => { face.setOpen(false) }}
        title={t('modal.title')}
        closeLabel={t('modal.close')}
        description={t('modal.description')}
      >
        <ul className={css.rows}>
          {state.devices.map(device => (
            <DeviceRow
              key={device.id}
              t={t}
              device={device}
              busy={state.busy.includes(device.id)}
              face={face}
            />
          ))}
        </ul>
        {state.devices.length === 0 && <p className={css.empty}>{t('list.empty')}</p>}
        {state.addOpen
          ? (
            <AddDeviceForm
              t={t}
              face={face}
              failure={state.failure}
              onDone={() => { face.setAddOpen(false) }}
            />
          )
          : (
            <div className={css.addToggle}>
              <Button size="sm" variant="outline" onClick={() => { face.setAddOpen(true) }}>
                {t('add.toggle')}
              </Button>
            </div>
          )}
      </Modal>
    </div>
  )
}
