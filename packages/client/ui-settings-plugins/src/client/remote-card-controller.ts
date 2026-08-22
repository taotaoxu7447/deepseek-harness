/**
 * The Remote card's staged editor over the `remote` settings section: the
 * roster of dsh hosts reachable through SSH tunnels. Every row is a draft
 * until Save writes the whole `devices` list — like the Vision chain beside
 * it, the list editor is validated by the Host at write time, so a half-typed
 * port never blocks a save client-side. Alongside the drafts, the card polls
 * the `remote` RPC domain for each device's live tunnel phase; the poll is
 * the card's own (this surface has no push channel), running while a card
 * polls and after every verb and save.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { createPollFold, listRemoteDevices, parseRemotePort, remoteTunnelFields } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Namespace of the remote roster section. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const REMOTE_NS = 'remote'

/** Poll period while a card is polling. */
export const REMOTE_POLL_MS = 2000

/** Tunnel lifecycle phases the Host reports. */
export type RemoteTunnelPhase = 'disconnected' | 'connecting' | 'ready' | 'failed'

/** One roster row as the section stores it. */
export interface RemoteDeviceRow {
  id: string
  label?: string
  sshTarget?: string
  remotePort?: number
  localPort?: number
  autoConnect?: boolean
}

/** The section this card edits. */
export interface RemoteSettings {
  devices?: RemoteDeviceRow[]
}

/** One device's live tunnel state as the remote domain reports it. */
export interface RemoteTunnelState {
  /** The roster id this state describes; the poll answer keys on it. */
  id: string
  /** Current lifecycle phase. */
  tunnel: RemoteTunnelPhase
  /** Human-readable failure or progress line, free of credential material. */
  detail?: string
  /** The tunneled UI address, present only while ready. */
  url?: string
}

/** Per-row port drafts, staged as text so a half-typed port never rewrites itself. */
export interface RemoteRowPorts {
  /** The remote dsh web port. */
  remotePort: string
  /** The loopback port the tunnel binds here. */
  localPort: string
}

/** What the Remote card renders. */
export interface RemoteCardState {
  /** False while the namespace is not served to this client. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether staged drafts differ from the stored section. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged. */
  failed: boolean
  /** Always false: the list editor validates on write, so saves are never blocked. */
  invalid: false
  /** The staged roster, in display order. */
  rows: readonly RemoteDeviceRow[]
  /** Per-row port drafts, indexed with `rows`. */
  rowPorts: readonly RemoteRowPorts[]
  /** Per-row live tunnel state, indexed with `rows`; absent before the first poll answers. */
  tunnels: readonly (RemoteTunnelState | undefined)[]
}

/** The registration-side face the Remote card's slot entry injects. */
export interface RemoteCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useRemoteCard. */
    remoteCard: SnapshotStore<RemoteCardState>
  }
  /** Edit one staged row's string or boolean field. */
  editRow: (index: number, field: keyof RemoteDeviceRow, value: string | boolean) => void
  /** Stage one row's port draft (blank omits the key at save). */
  editRowPort: (index: number, field: keyof RemoteRowPorts, value: string) => void
  /** Remove one staged row. */
  removeRow: (index: number) => void
  /** Append one staged row (id minted from a prefix + order). */
  addRow: () => void
  /** Start one device's tunnel. */
  connect: (index: number) => void
  /** Take one device's tunnel down. */
  disconnect: (index: number) => void
  /** Open one ready device's UI in a new browsing context. */
  openExternal: (index: number) => void
  /** Navigate this window to one ready device's UI. */
  openHere: (index: number) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit and re-seed from the stored section. */
  discard: () => void
  /** Start (true) or stop (false) the tunnel poll; the card's renderer owns the lifecycle. */
  setPolling: (active: boolean) => void
}

/** Blank port drafts for one newly staged row. */
function blankPorts(): RemoteRowPorts {
  return { remotePort: '', localPort: '' }
}

/** One staged roster row with its port drafts. */
interface RowEntry {
  /** The row as it will be written on save. */
  row: RemoteDeviceRow
  /** Per-row port drafts, staged as text. */
  ports: RemoteRowPorts
}

/** Browser ambient navigation surface, injected by tests. */
export interface RemoteNavigation {
  /** Open an address in a new browsing context. */
  open(url: string): void
  /** Navigate the current browsing context. */
  assign(url: string): void
}

/** Bridges the `remote` scope and the remote RPC domain onto the card. */
export class RemoteCardController {
  private readonly store: SnapshotStore<RemoteCardState>
  private entries: RowEntry[] = []
  private tunnels: RemoteTunnelState[] = []
  private dirty = false
  private saving = false
  private failed = false
  private polling = false
  private timer: ReturnType<typeof setInterval> | undefined
  /** Overlap-folded poll trigger, wired in the constructor. */
  private readonly poll: () => Promise<void>

  /**
   * @param scope - the bound settings scope for the `remote` namespace.
   * @param api - wire face used for tunnel state and verbs.
   * @param navigation - the window's navigation surface.
   */
  constructor(
    private readonly scope: SettingsScope<RemoteSettings>,
    private readonly api: Pick<IApiClient, 'remote'>,
    private readonly navigation: RemoteNavigation = {
      open: (url) => { window.open(url, '_blank', 'noopener') },
      assign: (url) => { window.location.assign(url) },
    },
  ) {
    this.store = createSnapshotStore(this.projection())
    this.poll = createPollFold(async () => {
      const devices = await listRemoteDevices(this.api)
      if (devices === undefined) return
      this.tunnels = devices.map(device => ({ id: device.id, ...remoteTunnelFields(device) }))
      this.store.set(this.projection())
    })
    this.reseed()
    scope.subscribe(() => { this.reseed() })
  }

  /** Re-seed every draft from the stored section. */
  private reseed(): void {
    const section = this.scope.getSnapshot().value
    this.entries = (section?.devices ?? []).map(row => ({
      row: {
        id: row.id,
        ...row.label !== undefined ? { label: row.label } : {},
        ...row.sshTarget !== undefined ? { sshTarget: row.sshTarget } : {},
        ...row.autoConnect !== undefined ? { autoConnect: row.autoConnect } : {},
      },
      ports: {
        remotePort: row.remotePort !== undefined ? String(row.remotePort) : '',
        localPort: row.localPort !== undefined ? String(row.localPort) : '',
      },
    }))
    this.dirty = false
    this.failed = false
    this.store.set(this.projection())
  }

  private projection(): RemoteCardState {
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: this.dirty,
      saving: this.saving,
      failed: this.failed,
      invalid: false,
      rows: this.entries.map(entry => entry.row),
      rowPorts: this.entries.map(entry => entry.ports),
      // Live state keys on the device id, so a reorder or reseed never shows
      // one device's tunnel beside another row.
      tunnels: this.entries.map(entry => this.tunnels.find(tunnel => tunnel.id === entry.row.id)),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its editor actions.
   */
  inject(): RemoteCardFace {
    return {
      hooks: { remoteCard: this.store },
      editRow: (index, field, value) => {
        const entry = this.entries[index]
        if (entry === undefined) return
        const next = { ...entry.row }
        // An emptied optional text field deletes the key: absent means
        // "inherit the deployment default". The id always keeps its text.
        if (typeof value === 'string' && value.trim() === '' && (field === 'label' || field === 'sshTarget')) {
          if (field === 'label') delete next.label
          else delete next.sshTarget
        } else {
          Object.assign(next, { [field]: typeof value === 'string' ? value.trim() : value })
        }
        entry.row = next
        this.markDirty()
      },
      editRowPort: (index, field, value) => {
        const entry = this.entries[index]
        if (entry === undefined) return
        entry.ports = { ...entry.ports, [field]: value }
        this.markDirty()
      },
      removeRow: (index) => {
        if (this.entries[index] === undefined) return
        this.entries.splice(index, 1)
        this.markDirty()
      },
      addRow: () => {
        const prefix = 'device'
        let n = this.entries.length + 1
        while (this.entries.some(entry => entry.row.id === `${prefix}-${n}`)) n += 1
        this.entries.push({ row: { id: `${prefix}-${n}` }, ports: blankPorts() })
        this.markDirty()
      },
      connect: (index) => { void this.verb(index, 'connect') },
      disconnect: (index) => { void this.verb(index, 'disconnect') },
      openExternal: (index) => {
        const url = this.urlOf(index)
        if (url !== undefined) this.navigation.open(url)
      },
      openHere: (index) => {
        const url = this.urlOf(index)
        if (url !== undefined) this.navigation.assign(url)
      },
      save: () => { void this.saveStaged() },
      discard: () => { this.reseed() },
      setPolling: (active) => {
        if (active === this.polling) return
        this.polling = active
        if (active) {
          void this.poll()
          this.timer = setInterval(() => { void this.poll() }, REMOTE_POLL_MS)
        } else {
          clearInterval(this.timer)
          this.timer = undefined
        }
      },
    }
  }

  private markDirty(): void {
    this.dirty = true
    this.failed = false
    this.store.set(this.projection())
  }

  /** One row's openable address: the URL its poll state reports, ready rows only. */
  private urlOf(index: number): string | undefined {
    const entry = this.entries[index]
    if (entry === undefined) return undefined
    return this.tunnels.find(tunnel => tunnel.id === entry.row.id)?.url
  }

  /** Run one tunnel verb against one row's id, then refresh state. */
  private async verb(index: number, which: 'connect' | 'disconnect'): Promise<void> {
    const entry = this.entries[index]
    if (entry === undefined) return
    await this.api.remote[which]({ id: entry.row.id }).catch(() => undefined)
    await this.poll()
  }

  /** Write the staged roster. */
  private async saveStaged(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable) return
    this.saving = true
    this.store.set(this.projection())
    try {
      // Capture the staged drafts before the write: a successful write
      // republishes the scope synchronously, and the re-seed that follows
      // would otherwise clear the drafts this save is still writing.
      const staged = this.entries.map((entry) => {
        const remotePort = parseRemotePort(entry.ports.remotePort)
        const localPort = parseRemotePort(entry.ports.localPort)
        return {
          ...entry.row,
          ...remotePort === undefined ? {} : { remotePort },
          ...localPort === undefined ? {} : { localPort },
        }
      })
      await this.scope.set('devices', staged)
    } catch (_saveFailure) {
      this.failed = true
    } finally {
      this.saving = false
      // Reseed drops the staged drafts either way; a failure flag, though,
      // must survive it — the card renders the rejection until the next edit.
      const failed = this.failed
      this.reseed()
      if (failed) {
        this.failed = true
        this.store.set(this.projection())
      }
      await this.poll()
    }
  }
}
