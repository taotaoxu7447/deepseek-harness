/**
 * Reasoning-effort declaration for one custom model row, in the compact text
 * form the Models page edits: comma-separated `level` or `level=wire` entries
 * (a bare level sends itself on the wire; bare `off` sends nothing), the
 * literal `false` for a non-reasoning model, and empty text for "inherit the
 * installed catalog". The vocabulary and validation mirror the Host's catalog
 * gate so a draft this card accepts always survives save; vendor presets fill
 * the common spellings the way the vision chain's presets do.
 */

/** Every UI level a model may declare, in escalation order. Mirrors the Host's
 * catalog gate; spelled here because a client package must not depend on a Host package. */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One effort level as the UI names it. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** The parsed declaration: undefined inherits, false disables, a dict declares level→wire. */
export type ReasoningEffortsValue = false | Partial<Record<EffortLevel, string | null>> | undefined

/** One vendor preset: a display id and the levels it offers (wire equals each level; `off` rides bare). */
export interface EffortPreset {
  /** Stable id the preset select carries. */
  id: string
  /** Levels the preset declares, in display order. */
  levels: readonly EffortLevel[]
}

/** Common vendor spellings, mirroring the vision chain's preset idea. */
export const EFFORT_PRESETS: readonly EffortPreset[] = [
  { id: 'deepseek-v4', levels: ['off', 'high', 'max'] },
  { id: 'openai-grades', levels: ['minimal', 'low', 'medium', 'high'] },
  { id: 'all-levels', levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
]

/**
 * Spell one stored declaration as the compact text the field shows.
 * @param value - the model draft's stored `reasoningEfforts`.
 * @returns the text: '' for inherit, 'false' for disabled, otherwise
 *   `off, high=high` style entries.
 */
export function formatReasoningEfforts(value: unknown): string {
  if (value === undefined) return ''
  if (value === false) return 'false'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const entries: string[] = []
  for (const level of EFFORT_LEVELS) {
    const wire = (value as Partial<Record<EffortLevel, unknown>>)[level]
    if (wire === undefined) continue
    if (wire === null) entries.push(level === 'off' ? 'off' : `${level}=`)
    else if (typeof wire === 'string') entries.push(wire === level ? level : `${level}=${wire}`)
  }
  return entries.join(', ')
}

/** One parsed outcome: either a usable declaration or the reason the text is not. */
export type ReasoningEffortsParse =
  | { ok: true; value: ReasoningEffortsValue }
  | { ok: false; reason: 'unknownLevel' | 'emptyWire' | 'offOnly' | 'emptyEntry' }

/**
 * Parse the compact text back into a declaration, enforcing the same rules the
 * Host's catalog gate applies at save: known levels only, every level beyond
 * `off` needs a non-empty wire value, and a declaration of nothing but `off`
 * offers no thinking to select.
 * @param text - the field's current text.
 * @returns the declaration the text spells, or why it cannot be one.
 */
export function parseReasoningEfforts(text: string): ReasoningEffortsParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  if (trimmed === 'false') return { ok: true, value: false }
  const value: Partial<Record<EffortLevel, string | null>> = {}
  let beyondOff = false
  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') return { ok: false, reason: 'emptyEntry' }
    const eq = entry.indexOf('=')
    const level = (eq === -1 ? entry : entry.slice(0, eq)).trim() as EffortLevel
    if (!(EFFORT_LEVELS as readonly string[]).includes(level)) return { ok: false, reason: 'unknownLevel' }
    const wire = eq === -1 ? level : entry.slice(eq + 1).trim()
    if (wire === '') {
      if (level !== 'off') return { ok: false, reason: 'emptyWire' }
      value[level] = null
      continue
    }
    // A bare `off` declares "send no effort parameter", the dict's null arm.
    value[level] = level === 'off' && eq === -1 ? null : wire
    if (level !== 'off') beyondOff = true
  }
  if (!beyondOff) return { ok: false, reason: 'offOnly' }
  return { ok: true, value }
}

/**
 * Spell one preset as the compact text that declares it.
 * @param preset - the chosen preset.
 * @returns the field text for the preset's levels.
 */
export function effortPresetText(preset: EffortPreset): string {
  return preset.levels.join(', ')
}
