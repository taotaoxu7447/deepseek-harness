/**
 * Vendor-preset effort mapping for the vision chain. One preset names whose
 * effort vocabulary a backend speaks; each protocol's fragment function turns
 * the configured choice into that protocol's request-body fields. Pairing a
 * preset with a protocol that cannot carry it is rejected by
 * `validateVisionConfig`; the fragment functions return an empty fragment for
 * those pairings because validation owns the rejection.
 *
 * Vendor facts behind the mapping: OpenAI grades `reasoning_effort` /
 * `reasoning.effort` across five levels; Xiaomi MiMo's server treats
 * low/medium/high identically, so only off (`none`) and on (`low`) are
 * meaningful; a local Qwen3 served the OpenAI-compatible way takes
 * `chat_template_kwargs` with `enable_thinking` and a token
 * `thinking_budget`; Anthropic extended thinking takes a token
 * `budget_tokens`.
 * @module @deepseek-ai/dsh-vision-qwen/effort
 */

import { assertNever } from '@deepseek-ai/dsh-llm'

/** Vendor effort vocabularies the chain maps onto each protocol's wire fields. */
export type VisionEffortPreset = 'openai' | 'mimo' | 'qwen-local' | 'anthropic'

/** Graded effort levels of the `openai` preset. */
export type VisionEffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high'

/** The level sent for a MiMo backend switched on: the server grades nothing beyond off. */
export const MIMO_ON_EFFORT: VisionEffortLevel = 'low'

/** The effort fields of one backend, resolved or configured. */
export interface VisionEffortOptions {
  /** Vendor preset selecting how effort maps onto the wire. Unset sends no effort parameter. */
  readonly effortPreset?: VisionEffortPreset
  /** Effort level for the `openai` preset. */
  readonly effortLevel?: VisionEffortLevel
  /** Effort toggle for the `mimo`, `qwen-local`, and `anthropic` presets. */
  readonly effortEnabled?: boolean
  /** Thinking budget (tokens) for `qwen-local` (`thinking_budget`) and `anthropic` (`budget_tokens`). */
  readonly thinkingBudget?: number
}

/**
 * Map one backend's effort choice onto the chat-completions request body.
 * @param options - the backend's resolved effort fields.
 * @returns body fields to spread; empty when nothing should be sent.
 */
export function chatEffortFragment(options: VisionEffortOptions): Record<string, unknown> {
  switch (options.effortPreset) {
    case undefined: return {}
    case 'openai':
      return options.effortLevel === undefined ? {} : { reasoning_effort: options.effortLevel }
    case 'mimo':
      return options.effortEnabled === undefined
        ? {}
        : { reasoning_effort: options.effortEnabled ? MIMO_ON_EFFORT : 'none' }
    case 'qwen-local':
      if (options.effortEnabled === undefined) return {}
      return {
        chat_template_kwargs: {
          enable_thinking: options.effortEnabled,
          ...options.effortEnabled && options.thinkingBudget !== undefined
            ? { thinking_budget: options.thinkingBudget }
            : {},
        },
      }
    // Chat completions carries no Anthropic thinking field; validation forbids the pairing.
    case 'anthropic': return {}
    /* v8 ignore next -- VisionEffortPreset is closed and every member is handled above */
    default: return assertNever(options.effortPreset)
  }
}

/**
 * Map one backend's effort choice onto the Responses request body.
 * @param options - the backend's resolved effort fields.
 * @returns body fields to spread; empty when nothing should be sent.
 */
export function responsesEffortFragment(options: VisionEffortOptions): Record<string, unknown> {
  switch (options.effortPreset) {
    case undefined: return {}
    case 'openai':
      return options.effortLevel === undefined ? {} : { reasoning: { effort: options.effortLevel } }
    case 'mimo':
      return options.effortEnabled === undefined
        ? {}
        : { reasoning: { effort: options.effortEnabled ? MIMO_ON_EFFORT : 'none' } }
    // `chat_template_kwargs` exists only on chat completions, and Anthropic
    // thinking only on Messages; validation forbids both pairings.
    case 'qwen-local':
    case 'anthropic': return {}
    /* v8 ignore next -- VisionEffortPreset is closed and every member is handled above */
    default: return assertNever(options.effortPreset)
  }
}

/**
 * Map one backend's effort choice onto the Anthropic Messages request body.
 * @param options - the backend's resolved effort fields.
 * @returns body fields to spread; empty when nothing should be sent.
 */
export function anthropicEffortFragment(options: VisionEffortOptions): Record<string, unknown> {
  switch (options.effortPreset) {
    case 'anthropic':
      // Validation guarantees `thinkingBudget` whenever the toggle stands on.
      return options.effortEnabled === true
        ? { thinking: { type: 'enabled', budget_tokens: options.thinkingBudget } }
        : {}
    // Other presets name no Anthropic wire field; validation forbids the pairings.
    case undefined:
    case 'openai':
    case 'mimo':
    case 'qwen-local': return {}
    /* v8 ignore next -- VisionEffortPreset is closed and every member is handled above */
    default: return assertNever(options.effortPreset)
  }
}
