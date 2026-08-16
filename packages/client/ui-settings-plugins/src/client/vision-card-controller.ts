/**
 * The Vision card's staged editor over the `vision` settings section: a
 * priority-ordered backend chain (index 0 served first; a backend exhausting
 * its attempt budget falls to the next). Every row is a draft until Save
 * writes the whole chain; the probe button answers both "is this endpoint
 * reachable with this key" and "which model ids does it serve" through the
 * vision-discovery domain, so a backend is configured without hand-copying a
 * model id.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Namespace of the vision chain section. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const VISION_NS = 'vision'

/** Upper bound on the chain; the Host caps the stored section the same way. */
export const VISION_MAX_BACKENDS = 5

/** Default attempts per backend, shown before the section carries one. */
export const DEFAULT_ATTEMPTS = 2

/**
 * Credential reference a row uses when its draft names none.
 * @param backendId - the row's stable id.
 * @returns the derived reference name.
 */
export function defaultKeyRef(backendId: string): string {
  return `VISION_${backendId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_API_KEY`
}

/** One backend row as the section stores it. */
export interface VisionBackendRow {
  id: string
  baseURL?: string
  model?: string
  apiKeyEnv?: string
  enabled?: boolean
}

/** The section this card edits. */
export interface VisionSettings {
  backends?: VisionBackendRow[]
  attemptsPerBackend?: number
}

/** One backend's credential state as the credentials domain last reported. */
export interface RowCredentialState {
  /** Reference this answer describes. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
}

/** Probe state for one row. */
export interface RowProbeState {
  /** True while the discovery request is crossing the wire. */
  probing: boolean
  /** Models the endpoint advertised, after a successful probe. */
  models: readonly { id: string; name?: string }[]
  /** Failure text after an unsuccessful probe; cleared by the next edit. */
  error?: string
}

/** What the Vision card renders. */
export interface VisionCardState {
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
  /** The staged chain, in priority order. */
  rows: readonly VisionBackendRow[]
  /** Whether another backend row can be added. */
  canAdd: boolean
  /** The staged attempts-per-backend draft. */
  attempts: string
  /** Per-row probe state, indexed with `rows`. */
  probes: readonly RowProbeState[]
  /** Per-row credential state, indexed with `rows`. */
  credentials: readonly RowCredentialState[]
}

/** The registration-side face the Vision card's slot entry injects. */
export interface VisionCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useVisionCard. */
    visionCard: SnapshotStore<VisionCardState>
  }
  /** Edit one staged row's field. */
  editRow: (index: number, field: keyof VisionBackendRow, value: string | boolean) => void
  /** Move one staged row up or down the priority order. */
  moveRow: (index: number, direction: -1 | 1) => void
  /** Remove one staged row. */
  removeRow: (index: number) => void
  /** Append one staged row (id minted from a prefix + order). */
  addRow: () => void
  /** Stage the attempts-per-backend draft. */
  editAttempts: (value: string) => void
  /** Stage one row's API key literal; it is written through the credentials domain on save. */
  editRowKey: (index: number, value: string) => void
  /** Probe one row's endpoint for reachability and its model listing. */
  probe: (index: number) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit and re-seed from the stored section. */
  discard: () => void
}

/** Bridges the `vision` scope, the credentials domain, and model discovery onto the card. */
export class VisionCardController {
  private readonly store: SnapshotStore<VisionCardState>
  private rows: VisionBackendRow[] = []
  private rowKeys: string[] = []
  private attempts = ''
  private probes: RowProbeState[] = []
  private credentials: RowCredentialState[] = []
  private dirty = false
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for the `vision` namespace.
   * @param api - wire face used for credential state and model discovery.
   */
  constructor(
    private readonly scope: SettingsScope<VisionSettings>,
    private readonly api: Pick<IApiClient, 'credentials' | 'vision'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.reseed()
    scope.subscribe(() => {
      this.reseed()
      void this.readCredentials()
    })
    void this.readCredentials()
  }

  /** Re-seed every draft from the stored section. */
  private reseed(): void {
    const snapshot = this.scope.getSnapshot()
    const section = snapshot.value
    this.rows = (section?.backends ?? []).map(row => ({
      id: row.id,
      ...row.baseURL !== undefined ? { baseURL: row.baseURL } : {},
      ...row.model !== undefined ? { model: row.model } : {},
      ...row.apiKeyEnv !== undefined ? { apiKeyEnv: row.apiKeyEnv } : {},
      ...row.enabled !== undefined ? { enabled: row.enabled } : {},
    }))
    this.rowKeys = this.rows.map(() => '')
    this.probes = this.rows.map(() => ({ probing: false, models: [] }))
    this.attempts = section?.attemptsPerBackend !== undefined ? String(section.attemptsPerBackend) : ''
    this.dirty = false
    this.failed = false
    this.store.set(this.projection())
  }

  private projection(): VisionCardState {
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: this.dirty,
      saving: this.saving,
      failed: this.failed,
      invalid: false,
      rows: this.rows,
      canAdd: this.rows.length < VISION_MAX_BACKENDS,
      attempts: this.attempts,
      probes: this.probes,
      credentials: this.credentials,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its editor actions.
   */
  inject(): VisionCardFace {
    return {
      hooks: { visionCard: this.store },
      editRow: (index, field, value) => {
        if (this.rows[index] === undefined) return
        this.rows = this.rows.map((row, i) => i === index
          ? { ...row, [field]: typeof value === 'string' ? value.trim() : value }
          : row)
        this.probes = this.probes.map((probe, i) => i === index ? { probing: false, models: [] } : probe)
        this.markDirty()
      },
      moveRow: (index, direction) => {
        const target = index + direction
        if (index < 0 || target < 0 || target >= this.rows.length) return
        const moved = <T>(list: readonly T[]): T[] => {
          const copy = [...list]
          const [item] = copy.splice(index, 1)
          copy.splice(target, 0, item as T)
          return copy
        }
        this.rows = moved(this.rows)
        this.rowKeys = moved(this.rowKeys)
        this.probes = moved(this.probes)
        this.markDirty()
      },
      removeRow: (index) => {
        if (index < 0 || index >= this.rows.length) return
        this.rows = this.rows.filter((_row, i) => i !== index)
        this.rowKeys = this.rowKeys.filter((_key, i) => i !== index)
        this.probes = this.probes.filter((_probe, i) => i !== index)
        this.markDirty()
      },
      addRow: () => {
        if (this.rows.length >= VISION_MAX_BACKENDS) return
        const prefix = 'backend'
        let n = this.rows.length + 1
        while (this.rows.some(row => row.id === `${prefix}-${n}`)) n += 1
        this.rows = [...this.rows, { id: `${prefix}-${n}`, enabled: true }]
        this.rowKeys = [...this.rowKeys, '']
        this.probes = [...this.probes, { probing: false, models: [] }]
        this.markDirty()
      },
      editAttempts: (value) => {
        this.attempts = value
        this.markDirty()
      },
      editRowKey: (index, value) => {
        this.rowKeys = this.rowKeys.map((key, i) => i === index ? value : key)
        this.markDirty()
      },
      probe: (index) => { void this.probeRow(index) },
      save: () => { void this.saveStaged() },
      discard: () => { this.reseed() },
    }
  }

  private markDirty(): void {
    this.dirty = true
    this.failed = false
    this.store.set(this.projection())
  }

  /** Probe one row's endpoint; the key draft wins over the stored reference. */
  private async probeRow(index: number): Promise<void> {
    const row = this.rows[index]
    if (row?.baseURL === undefined || row.baseURL.trim() === '') {
      this.probes[index] = { probing: false, models: [], error: 'enter the endpoint base URL first' }
      this.store.set(this.projection())
      return
    }
    const keyDraft = this.rowKeys[index]?.trim() ?? ''
    const apiKeyEnv = row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0
      ? row.apiKeyEnv
      : defaultKeyRef(row.id)
    this.probes = this.probes.map((probe, i) => i === index ? { probing: true, models: [] } : probe)
    this.store.set(this.projection())
    const response = await this.api.vision.discoverModels({
      baseURL: row.baseURL.trim(),
      ...keyDraft.length > 0 ? { apiKey: keyDraft } : {},
      ...keyDraft.length === 0 ? { apiKeyEnv } : {},
    }).catch(() => undefined)
    const result = response?.result
    if (!result?.ok) {
      const failure = response === undefined
        ? 'the probe could not reach the deployment'
        : response.result.ok ? 'the probe failed' : response.result.error.message
      this.probes = this.probes.map((probe, i) => i === index
        ? { probing: false, models: [], error: failure }
        : probe)
      this.store.set(this.projection())
      return
    }
    const advertised = result.value.models
    this.probes = this.probes.map((probe, i) => i === index ? { probing: false, models: advertised } : probe)
    // A single advertised model speaks for itself: stage it.
    if (advertised.length === 1 && row.model === undefined) {
      this.rows = this.rows.map((candidate, i) => i === index
        ? { ...candidate, model: advertised[0]?.id ?? '' }
        : candidate)
      this.dirty = true
    }
    this.store.set(this.projection())
  }

  /** Write the staged chain and the staged keys. */
  private async saveStaged(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable) return
    this.saving = true
    this.store.set(this.projection())
    // Capture the staged drafts before the first write: a successful write
    // republishes the scope synchronously, and the re-seed that follows would
    // otherwise clear the very drafts this save is still writing.
    const stagedRows = this.rows.map(row => ({ ...row }))
    const stagedKeys = [...this.rowKeys]
    const stagedAttempts = this.attempts.trim()
    try {
      await this.scope.set('backends', stagedRows)
      const attempts = Number(stagedAttempts)
      if (stagedAttempts !== '' && Number.isFinite(attempts)) {
        await this.scope.set('attemptsPerBackend', Math.max(1, Math.trunc(attempts)))
      } else {
        await this.scope.unset('attemptsPerBackend')
      }
      for (const [index, row] of stagedRows.entries()) {
        const keyDraft = stagedKeys[index]?.trim() ?? ''
        if (keyDraft.length === 0) continue
        const apiKeyEnv = row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0
          ? row.apiKeyEnv
          : defaultKeyRef(row.id)
        await this.api.credentials.set({ ref: apiKeyEnv, value: keyDraft })
      }
    } catch (_saveFailure) {
      this.failed = true
    } finally {
      this.saving = false
      this.reseed()
    }
  }

  /** Ask the credentials domain about every row's reference, in one batch. */
  private async readCredentials(): Promise<void> {
    const refs = this.rows.map(row =>
      row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0 ? row.apiKeyEnv : defaultKeyRef(row.id))
    if (refs.length === 0) {
      this.credentials = []
      this.store.set(this.projection())
      return
    }
    const response = await this.api.credentials.describe({ refs }).catch(() => undefined)
    const result = response?.result
    if (!result?.ok) return
    this.credentials = refs.map(ref => ({
      ref,
      configured: result.value.credentials[ref]?.configured ?? false,
    }))
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to a reference some row watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    const watched = this.credentials.some(state => state.ref === ref)
      || this.rows.some(row => defaultKeyRef(row.id) === ref || row.apiKeyEnv === ref)
    if (watched) void this.readCredentials()
  }
}
