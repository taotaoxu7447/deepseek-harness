/**
 * The Vision card's staged editor over the `vision` settings section: a
 * priority-ordered backend chain (index 0 served first; a backend exhausting
 * its attempt budget falls to the next). Every row is a draft until Save
 * writes the whole chain; the probe button answers both "is this endpoint
 * reachable with this key" and "which model ids does it serve" through the
 * vision-discovery domain, so a backend is configured without hand-copying a
 * model id. Per-row effort, context, and input-limit fields ride the same
 * section; the Host's section validator rejects contradictory combinations
 * (an effort preset its protocol cannot carry, a budget over the context
 * window) at save.
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

/** Wire protocols a backend row may speak; mirrors the Host's config vocabulary. */
export type VisionProtocol = 'openai-chat' | 'openai-responses' | 'anthropic'

/** Vendor effort presets; mirrors the Host's config vocabulary. */
export type VisionEffortPreset = 'openai' | 'mimo' | 'qwen-local' | 'anthropic'

/** Graded effort levels of the `openai` preset; mirrors the Host's config vocabulary. */
export type VisionEffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high'

/** Per-row numeric fields staged as free text until save parses them. */
export type VisionRowNumberField = 'thinkingBudget' | 'contextTokens' | 'maxInputTokens'

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
  protocol?: VisionProtocol
  effortPreset?: VisionEffortPreset
  effortLevel?: VisionEffortLevel
  effortEnabled?: boolean
  thinkingBudget?: number
  contextTokens?: number
  maxInputTokens?: number
}

/** The section this card edits. */
export interface VisionSettings {
  backends?: VisionBackendRow[]
  attemptsPerBackend?: number
}

/** One row's numeric drafts, staged as text so a half-typed value never rewrites itself. */
export interface RowNumberDrafts {
  /** Thinking budget (tokens) for the `qwen-local` and `anthropic` presets. */
  thinkingBudget: string
  /** Advertised context window (tokens). */
  contextTokens: string
  /** Estimated-input guard (tokens). */
  maxInputTokens: string
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
  /** Per-row numeric drafts, indexed with `rows`. */
  rowNumbers: readonly RowNumberDrafts[]
  /** Per-row key drafts, indexed with `rows`; never read back from the credential store. */
  rowKeys: readonly string[]
  /** Per-row "already configured" flag, indexed with `rows`; the card collapses those rows by default. */
  rowConfigured: readonly boolean[]
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
  /** Edit one staged row's string or boolean field. */
  editRow: (index: number, field: keyof VisionBackendRow, value: string | boolean) => void
  /** Stage one row's numeric draft (blank omits the key at save). */
  editRowNumber: (index: number, field: VisionRowNumberField, value: string) => void
  /** Move one staged row up or down the priority order. */
  moveRow: (index: number, direction: -1 | 1) => void
  /** Move one staged row to an absolute position in the priority order. */
  moveRowTo: (from: number, to: number) => void
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

/** Blank row-number drafts for one newly staged row. */
function blankRowNumbers(): RowNumberDrafts {
  return { thinkingBudget: '', contextTokens: '', maxInputTokens: '' }
}

/**
 * Parse one staged numeric draft.
 * @param draft - the staged text; a `k`/`m` suffix scales by 1024/1024².
 * @returns the parsed integer, or `undefined` for a blank draft.
 * @throws Error on a non-blank draft that is not a number with an optional suffix.
 */
function parseRowNumber(draft: string): number | undefined {
  const trimmed = draft.trim()
  if (trimmed === '') return undefined
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(trimmed)
  if (match === null) throw new Error(`not a number: ${trimmed}`)
  /* v8 ignore next -- both capture groups always participate in a successful match; the fallback only satisfies noUncheckedIndexedAccess */
  const suffix = match[2] ?? ''
  const scale = suffix === '' ? 1 : suffix.toLowerCase() === 'k' ? 1024 : 1024 * 1024
  /* v8 ignore next -- both capture groups always participate in a successful match; the fallback only satisfies noUncheckedIndexedAccess */
  return Math.max(1, Math.trunc(Number(match[1] ?? '') * scale))
}

/**
 * Apply one staged edit to a row. An empty enum draft deletes the key: '' is
 * not a member of the protocol/preset/level unions, and absent means "send
 * nothing". A preset switch selects which effort control renders; values of
 * the previous preset's control must not leak into the next save.
 * @param row - the staged row.
 * @param field - the edited field.
 * @param value - the staged draft (toggles report 'on'/'off'-derived booleans).
 * @returns the edited row.
 */
function editRowData(row: VisionBackendRow, field: keyof VisionBackendRow, value: string | boolean): VisionBackendRow {
  // An empty enum draft deletes the key: '' is not a member of the
  // protocol/preset/level unions, and absent means "send nothing". Clearing
  // the preset runs the same cascade as switching it (below). An emptied
  // text field keeps its empty draft instead.
  if (typeof value === 'string' && value.trim() === ''
    && (field === 'protocol' || field === 'effortPreset' || field === 'effortLevel')) {
    const next = { ...row }
    if (field === 'protocol') delete next.protocol
    if (field === 'effortPreset') {
      delete next.effortPreset
      delete next.effortLevel
      delete next.effortEnabled
    }
    if (field === 'effortLevel') delete next.effortLevel
    return next
  }
  const next: VisionBackendRow = { ...row, [field]: typeof value === 'string' ? value.trim() : value }
  // A preset switch selects which effort control renders; values of the
  // previous preset's control must not leak into the next save.
  if (field === 'effortPreset') {
    delete next.effortLevel
    delete next.effortEnabled
  }
  return next
}

/** One staged chain row with its per-row key draft, numeric drafts, and probe state. */
interface RowEntry {
  /** The row as it will be written on save. */
  row: VisionBackendRow
  /** Staged API key literal; written through the credentials domain on save. */
  key: string
  /** Per-row numeric drafts, staged as text so a half-typed value never rewrites itself. */
  numbers: RowNumberDrafts
  /** Probe state for this row. */
  probe: RowProbeState
  /**
   * Whether this row arrived from the stored section with a model filled.
   * Stored-and-filled rows collapse by default; a row added this session (or a
   * stored row missing its model, which needs attention) starts expanded.
   */
  configured: boolean
}

/** Bridges the `vision` scope, the credentials domain, and model discovery onto the card. */
export class VisionCardController {
  private readonly store: SnapshotStore<VisionCardState>
  private entries: RowEntry[] = []
  private attempts = ''
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
    this.entries = (section?.backends ?? []).map(row => ({
      row: {
        id: row.id,
        ...row.baseURL !== undefined ? { baseURL: row.baseURL } : {},
        ...row.model !== undefined ? { model: row.model } : {},
        ...row.apiKeyEnv !== undefined ? { apiKeyEnv: row.apiKeyEnv } : {},
        ...row.enabled !== undefined ? { enabled: row.enabled } : {},
        ...row.protocol !== undefined ? { protocol: row.protocol } : {},
        ...row.effortPreset !== undefined ? { effortPreset: row.effortPreset } : {},
        ...row.effortLevel !== undefined ? { effortLevel: row.effortLevel } : {},
        ...row.effortEnabled !== undefined ? { effortEnabled: row.effortEnabled } : {},
      },
      key: '',
      numbers: {
        thinkingBudget: row.thinkingBudget !== undefined ? String(row.thinkingBudget) : '',
        contextTokens: row.contextTokens !== undefined ? String(row.contextTokens) : '',
        maxInputTokens: row.maxInputTokens !== undefined ? String(row.maxInputTokens) : '',
      },
      probe: { probing: false, models: [] },
      configured: (row.model ?? '').trim() !== '',
    }))
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
      rows: this.entries.map(entry => entry.row),
      rowNumbers: this.entries.map(entry => entry.numbers),
      rowKeys: this.entries.map(entry => entry.key),
      rowConfigured: this.entries.map(entry => entry.configured),
      canAdd: this.entries.length < VISION_MAX_BACKENDS,
      attempts: this.attempts,
      probes: this.entries.map(entry => entry.probe),
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
        const entry = this.entries[index]
        if (entry === undefined) return
        entry.row = editRowData(entry.row, field, value)
        entry.probe = { probing: false, models: [] }
        this.markDirty()
      },
      editRowNumber: (index, field, value) => {
        const entry = this.entries[index]
        if (entry === undefined) return
        entry.numbers = { ...entry.numbers, [field]: value }
        this.markDirty()
      },
      moveRow: (index, direction) => {
        this.moveEntryTo(index, index + direction)
      },
      moveRowTo: (from, to) => {
        this.moveEntryTo(from, to)
      },
      removeRow: (index) => {
        if (this.entries[index] === undefined) return
        this.entries.splice(index, 1)
        this.markDirty()
      },
      addRow: () => {
        if (this.entries.length >= VISION_MAX_BACKENDS) return
        const prefix = 'backend'
        let n = this.entries.length + 1
        while (this.entries.some(entry => entry.row.id === `${prefix}-${n}`)) n += 1
        this.entries.push({
          row: { id: `${prefix}-${n}`, enabled: true },
          key: '',
          numbers: blankRowNumbers(),
          probe: { probing: false, models: [] },
          configured: false,
        })
        this.markDirty()
      },
      editAttempts: (value) => {
        this.attempts = value
        this.markDirty()
      },
      editRowKey: (index, value) => {
        const entry = this.entries[index]
        if (entry === undefined) return
        entry.key = value
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

  /**
   * Move one staged entry to an absolute position in the chain.
   * @param from - the entry's current index.
   * @param to - the target index.
   */
  private moveEntryTo(from: number, to: number): void {
    const entry = this.entries[from]
    if (entry === undefined || from === to || to < 0 || to >= this.entries.length) return
    this.entries.splice(from, 1)
    this.entries.splice(to, 0, entry)
    this.markDirty()
  }

  /** Replace one row's probe state and republish. */
  private setProbe(entry: RowEntry, probe: RowProbeState): void {
    entry.probe = probe
    this.store.set(this.projection())
  }

  /** Probe one row's endpoint; the key draft wins over the stored reference. */
  private async probeRow(index: number): Promise<void> {
    const entry = this.entries[index]
    if (entry === undefined) return
    const baseURL = (entry.row.baseURL ?? '').trim()
    if (baseURL === '') {
      this.setProbe(entry, { probing: false, models: [], error: 'enter the endpoint base URL first' })
      return
    }
    const keyDraft = entry.key.trim()
    const apiKeyEnv = entry.row.apiKeyEnv !== undefined && entry.row.apiKeyEnv.length > 0
      ? entry.row.apiKeyEnv
      : defaultKeyRef(entry.row.id)
    this.setProbe(entry, { probing: true, models: [] })
    const response = await this.api.vision.discoverModels({
      baseURL,
      protocol: entry.row.protocol ?? 'openai-chat',
      ...keyDraft.length > 0 ? { apiKey: keyDraft } : {},
      ...keyDraft.length === 0 ? { apiKeyEnv } : {},
    }).catch(() => undefined)
    const result = response?.result
    if (result !== undefined && result.ok) {
      const advertised = result.value.models
      this.setProbe(entry, { probing: false, models: advertised })
      // A single advertised model speaks for itself: stage it.
      if (advertised.length === 1 && entry.row.model === undefined) {
        for (const only of advertised) {
          entry.row = { ...entry.row, model: only.id }
        }
        this.dirty = true
        this.store.set(this.projection())
      }
      return
    }
    const failure = response === undefined
      ? 'the probe could not reach the deployment'
      : result === undefined ? 'the probe failed' : result.error.message
    this.setProbe(entry, { probing: false, models: [], error: failure })
  }

  /** Write the staged chain and the staged keys. */
  private async saveStaged(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable) return
    this.saving = true
    this.store.set(this.projection())
    try {
      // Capture the staged drafts before the first write: a successful write
      // republishes the scope synchronously, and the re-seed that follows
      // would otherwise clear the very drafts this save is still writing.
      const staged = this.entries.map((entry) => {
        const thinkingBudget = parseRowNumber(entry.numbers.thinkingBudget)
        const contextTokens = parseRowNumber(entry.numbers.contextTokens)
        const maxInputTokens = parseRowNumber(entry.numbers.maxInputTokens)
        return {
          row: {
            ...entry.row,
            ...thinkingBudget === undefined ? {} : { thinkingBudget },
            ...contextTokens === undefined ? {} : { contextTokens },
            ...maxInputTokens === undefined ? {} : { maxInputTokens },
          },
          key: entry.key.trim(),
        }
      })
      const stagedAttempts = this.attempts.trim()
      await this.scope.set('backends', staged.map(entry => entry.row))
      const attempts = Number(stagedAttempts)
      if (stagedAttempts !== '' && Number.isFinite(attempts)) {
        await this.scope.set('attemptsPerBackend', Math.max(1, Math.trunc(attempts)))
      } else {
        await this.scope.unset('attemptsPerBackend')
      }
      for (const { row, key } of staged) {
        if (key.length === 0) continue
        const apiKeyEnv = row.apiKeyEnv !== undefined && row.apiKeyEnv.length > 0
          ? row.apiKeyEnv
          : defaultKeyRef(row.id)
        await this.api.credentials.set({ ref: apiKeyEnv, value: key })
      }
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
    }
  }

  /** Ask the credentials domain about every row's reference, in one batch. */
  private async readCredentials(): Promise<void> {
    const refs = this.entries.map(entry =>
      entry.row.apiKeyEnv !== undefined && entry.row.apiKeyEnv.length > 0
        ? entry.row.apiKeyEnv
        : defaultKeyRef(entry.row.id))
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
      || this.entries.some(entry => defaultKeyRef(entry.row.id) === ref || entry.row.apiKeyEnv === ref)
    if (watched) void this.readCredentials()
  }
}
