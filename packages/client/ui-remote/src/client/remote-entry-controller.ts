/**
 * The sidebar remote entry's controller: a live view over the `remote` RPC
 * domain (device roster plus tunnel phases), the connect/disconnect verbs,
 * the two open gestures (a window tab through ctx.layout, or a new browsing
 * context the native shell routes into an app window), and the add-device
 * write against the `remote` settings section. The poll runs once at
 * construction — so the trigger's status dot reflects tunnels the Host
 * auto-connected at boot — and continuously while the modal is open, which is
 * the only surface that watches phases change.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createPollFold, listRemoteDevices, parseRemotePort, remoteTunnelFields } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

/**
 * Namespace of the remote roster section. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const REMOTE_NS = 'remote'

/** Poll period while the modal is open. */
export const REMOTE_ENTRY_POLL_MS = 2000

/** Query parameter carrying the device label to the native shell's new-window routing. */
export const REMOTE_LABEL_PARAM = 'dshRemoteLabel'

/** Tunnel lifecycle phases the Host reports. */
export type RemoteTunnelPhase = 'disconnected' | 'connecting' | 'ready' | 'failed'

/** One roster device with its live tunnel state, as the remote domain answers. */
export interface RemoteEntryDevice {
  id: string
  label?: string
  sshTarget: string
  remotePort: number
  localPort: number
  autoConnect: boolean
  tunnel: RemoteTunnelPhase
  detail?: string
  /** The tunneled UI address, present only while ready. */
  url?: string
}

/** The section slice the add-device write extends. */
export interface RemoteSettings {
  devices?: {
    id: string
    label?: string
    sshTarget?: string
    remotePort?: number
    localPort?: number
    autoConnect?: boolean
  }[]
}

/** What the add form submits; ports stay text until validation parses them. */
export interface AddDeviceDraft {
  label: string
  sshTarget: string
  remotePort: string
  localPort: string
  autoConnect: boolean
}

/** What the entry renders. */
export interface RemoteEntryState {
  /** False until the remote domain answers once (and on surfaces without it). */
  available: boolean
  /** Whether the device modal is open. */
  open: boolean
  /** Whether the add-device form is unfolded inside the modal. */
  addOpen: boolean
  /** The roster with live phases, in roster order. */
  devices: readonly RemoteEntryDevice[]
  /** Ids with a connect/disconnect/save in flight. */
  busy: readonly string[]
  /** The last add-device rejection, cleared by the next edit or attempt. */
  failure?: string
}

/** The registration-side face the entry's slot registration injects. */
export interface RemoteEntryFace {
  hooks: {
    /** Entry snapshot bound by the renderer as useRemoteEntry. */
    remoteEntry: SnapshotStore<RemoteEntryState>
  }
  /** Open or close the device modal; opening starts the poll, closing stops it. */
  setOpen: (open: boolean) => void
  /** Fold or unfold the add-device form. */
  setAddOpen: (open: boolean) => void
  /** Start one device's tunnel. */
  connect: (id: string) => void
  /** Take one device's tunnel down. */
  disconnect: (id: string) => void
  /** Stage one ready device's UI as a window tab. */
  openHere: (id: string) => void
  /** Open one ready device's UI in a new browsing context (an app window under the native shell). */
  openExternal: (id: string) => void
  /** Validate and append one staged device, then connect it when it asked to auto-connect. */
  addDevice: (draft: AddDeviceDraft) => void
}

/** Browser ambient new-context surface, injected by tests. */
export interface RemoteEntryNavigation {
  /** Open an address in a new browsing context. */
  open(url: string): void
}

/**
 * The display label a device carries: its configured label, else its id.
 * @param device - the roster row to label.
 * @returns the human-facing name.
 */
export function deviceLabel(device: Pick<RemoteEntryDevice, 'id' | 'label'>): string {
  return typeof device.label === 'string' && device.label.length > 0 ? device.label : device.id
}

/**
 * Mint a roster id for a new device: a slug of its label when that is free,
 * else `device-N` counting past every configured id.
 * @param label - the form's display-name text.
 * @param taken - the roster's current ids.
 * @returns a collision-free id.
 */
export function mintDeviceId(label: string, taken: ReadonlySet<string>): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > 0 && !taken.has(slug)) return slug
  let n = taken.size + 1
  while (taken.has(`device-${String(n)}`)) n += 1
  return `device-${String(n)}`
}

/** Bridges the `remote` RPC domain, the `remote` settings scope, and ctx.layout onto the entry. */
export class RemoteEntryController {
  private readonly store: SnapshotStore<RemoteEntryState>
  private devices: RemoteEntryDevice[] = []
  private busy = new Set<string>()
  private openState = false
  private addOpenState = false
  private failure: string | undefined
  private available = false
  private timer: ReturnType<typeof setInterval> | undefined
  /** Overlap-folded poll trigger, wired in the constructor. */
  private readonly poll: () => Promise<void>

  /**
   * @param scope - the bound settings scope for the `remote` namespace.
   * @param api - wire face carrying the remote domain.
   * @param layout - the window's tab-stage face.
   * @param navigation - the window's new-context surface.
   */
  constructor(
    private readonly scope: SettingsScope<RemoteSettings>,
    private readonly api: Pick<IApiClient, 'remote'>,
    private readonly layout: Pick<ILayout, 'openRemoteTab'>,
    private readonly navigation: RemoteEntryNavigation = {
      open: (url) => { window.open(url, '_blank', 'noopener') },
    },
  ) {
    this.store = createSnapshotStore(this.projection())
    this.poll = createPollFold(async () => {
      const devices = await listRemoteDevices(this.api)
      if (devices === undefined) return
      this.available = true
      this.devices = devices.map(device => ({
        id: device.id,
        ...device.label === undefined ? {} : { label: device.label },
        sshTarget: device.sshTarget,
        remotePort: device.remotePort,
        localPort: device.localPort,
        autoConnect: device.autoConnect,
        ...remoteTunnelFields(device),
      }))
      this.store.set(this.projection())
    })
    // One bootstrap read: the trigger's dot should reflect tunnels the Host
    // auto-connected while the app booted, without a continuous idle poll.
    void this.poll()
  }

  private projection(): RemoteEntryState {
    return {
      available: this.available,
      open: this.openState,
      addOpen: this.addOpenState,
      devices: this.devices,
      busy: [...this.busy],
      ...this.failure === undefined ? {} : { failure: this.failure },
    }
  }

  /** Stop the modal poll; idempotent, safe at fiber disposal. */
  dispose(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Build the face the entry's slot registration injects.
   * @returns the entry's snapshot and its actions.
   */
  inject(): RemoteEntryFace {
    return {
      hooks: { remoteEntry: this.store },
      setOpen: (open) => {
        if (open === this.openState) return
        this.openState = open
        if (open) {
          void this.poll()
          this.timer = setInterval(() => { void this.poll() }, REMOTE_ENTRY_POLL_MS)
        } else {
          clearInterval(this.timer)
          this.timer = undefined
          this.addOpenState = false
        }
        this.store.set(this.projection())
      },
      setAddOpen: (open) => {
        this.addOpenState = open
        this.failure = undefined
        this.store.set(this.projection())
      },
      connect: (id) => { void this.verb(id, 'connect') },
      disconnect: (id) => { void this.verb(id, 'disconnect') },
      openHere: (id) => {
        const device = this.devices.find(candidate => candidate.id === id)
        if (device?.url === undefined) return
        this.layout.openRemoteTab({ id: device.id, label: deviceLabel(device), url: device.url })
      },
      openExternal: (id) => {
        const device = this.devices.find(candidate => candidate.id === id)
        if (device?.url === undefined) return
        // The label rides the URL so the native shell can title the window it
        // opens; a plain browser ignores the parameter.
        const joiner = device.url.includes('?') ? '&' : '?'
        this.navigation.open(`${device.url}${joiner}${REMOTE_LABEL_PARAM}=${encodeURIComponent(deviceLabel(device))}`)
      },
      addDevice: (draft) => { void this.addDevice(draft) },
    }
  }

  /** Run one tunnel verb against one device, then refresh state. */
  private async verb(id: string, which: 'connect' | 'disconnect'): Promise<void> {
    this.busy.add(id)
    this.store.set(this.projection())
    try {
      await this.api.remote[which]({ id }).catch(() => undefined)
      await this.poll()
    } finally {
      this.busy.delete(id)
      this.store.set(this.projection())
    }
  }

  /** Validate, write, and connect one staged device. */
  private async addDevice(draft: AddDeviceDraft): Promise<void> {
    const sshTarget = draft.sshTarget.trim()
    if (sshTarget.length === 0) {
      this.failure = 'add.targetRequired'
      this.store.set(this.projection())
      return
    }
    let remotePort: number | undefined
    let localPort: number | undefined
    try {
      remotePort = parseRemotePort(draft.remotePort)
      localPort = parseRemotePort(draft.localPort)
    } catch {
      this.failure = 'add.failed'
      this.store.set(this.projection())
      return
    }
    const taken = new Set(this.devices.map(device => device.id))
    const id = mintDeviceId(draft.label, taken)
    const label = draft.label.trim()
    const row = {
      id,
      ...label.length === 0 ? {} : { label },
      sshTarget,
      ...remotePort === undefined ? {} : { remotePort },
      ...localPort === undefined ? {} : { localPort },
      ...draft.autoConnect ? { autoConnect: true } : {},
    }
    this.busy.add(id)
    this.store.set(this.projection())
    try {
      // The roster write extends the stored list, not the polled view: a
      // device whose row a deployment keeps but whose tunnel the Host has not
      // built yet must not be dropped by re-adding from the RPC answer.
      const stored = this.scope.getSnapshot().value?.devices ?? []
      await this.scope.set('devices', [...stored, row])
      if (draft.autoConnect) await this.api.remote.connect({ id }).catch(() => undefined)
      this.addOpenState = false
      await this.poll()
    } catch {
      this.failure = 'add.failed'
      this.store.set(this.projection())
    } finally {
      this.busy.delete(id)
      this.store.set(this.projection())
    }
  }
}
