/**
 * Input-modality declaration capsules for one model row — the text/image
 * chips that declare whether a model is pure-text or vision-capable, in the
 * spirit of the reasoning-effort chips beside them. Both adapters spell the
 * declaration as an array on the model entry (`input` on a pi-ai profile row,
 * `inputModalities` on a DeepSeek catalog row) whose absence means the same
 * thing everywhere this component is used: text only. `text` is the floor and
 * stays on — no model this harness serves can refuse it — so the only gesture
 * is toggling `image`: on writes the explicit `['text', 'image']`, off drops
 * the key and returns the row to the text-only default.
 */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Every modality a declaration may name, in display order. */
export const MODALITIES = ['text', 'image'] as const

/** One declarable modality. */
export type Modality = (typeof MODALITIES)[number]

/**
 * Read a row's stored declaration, tolerating a hand-written value.
 * @param model - the model row as drafted.
 * @param key - the adapter's field name (`input` or `inputModalities`).
 * @returns the declared modalities, or `undefined` when the key is absent or
 *   not an array at all (a string hand-written into yaml reads as undeclared
 *   rather than crashing the editor).
 */
export function modalitiesOf(model: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = model[key]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined
}

/**
 * Whether a declaration switches one modality on. An undeclared row answers
 * for the default: text on, everything else off.
 * @param declared - the stored declaration, or `undefined` when unset.
 * @param modality - the modality asked about.
 */
export function modalityOn(declared: readonly string[] | undefined, modality: Modality): boolean {
  if (declared === undefined) return modality === 'text'
  return declared.includes(modality)
}

/**
 * Flip one modality.
 * @param declared - the stored declaration, or `undefined` when unset.
 * @param modality - the modality to flip.
 * @returns the next value to store: the explicit pair for a vision model, or
 *   `undefined` — drop the key — whenever the result carries no `image`, so a
 *   text-only row is spelled as the default rather than as a redundant
 *   explicit `['text']` (and a hand-written image-only row is repaired back
 *   to the text floor instead of toggling into an empty declaration both
 *   schemas refuse).
 */
export function toggleModality(declared: readonly string[] | undefined, modality: Modality): readonly string[] | undefined {
  const on = modalityOn(declared, modality)
  if (modality === 'image') {
    return on ? undefined : ['text', 'image']
  }
  // text: the floor. Toggling it off is refused by the chip being disabled;
  // toggling it on repairs a declaration that lost it. An undeclared row
  // already reads as text-on, so reaching the write means a stored array.
  if (declared === undefined || on) return declared
  return ['text', ...declared.filter(entry => entry !== 'text')]
}

/** Props of {@link ModalityChips}. */
export interface ModalityChipsProps {
  /** The row's stored declaration, or `undefined` when undeclared. */
  value: readonly string[] | undefined
  /** Store the next declaration; `undefined` drops the key. */
  onChange: (next: readonly string[] | undefined) => void
  /** Disable both chips. */
  disabled: boolean
  /** Accessible group label, unique per row. */
  ariaLabel: string
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render the text/image capsules.
 * @param props - the stored declaration, the write, and copy.
 * @returns the capsule group with its hint.
 */
export function ModalityChips(props: ModalityChipsProps): ReactNode {
  return (
    <>
      <div
        className={styles['effortLevels']}
        role="group"
        aria-label={props.ariaLabel}
      >
        {MODALITIES.map((modality) => {
          const on = modalityOn(props.value, modality)
          // text is the floor: an on text chip is a statement, not a toggle.
          const locked = modality === 'text' && on
          return (
            <button
              key={modality}
              type="button"
              className={`${styles['effortChip']}${on ? ` ${styles['effortChipOn']}` : ''}`}
              aria-pressed={on}
              aria-label={`${props.ariaLabel} ${modality}`}
              disabled={props.disabled || locked}
              onClick={() => { props.onChange(toggleModality(props.value, modality)) }}
            >
              {modality}
            </button>
          )
        })}
      </div>
      <span className={styles['effortHint']}>{props.t('modelInputModalitiesHint')}</span>
    </>
  )
}
