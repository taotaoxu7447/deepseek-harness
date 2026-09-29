/**
 * `@deepseek-ai/dsh-vision-qwen`: registers the multi-protocol vision chain
 * with `ctx.vision` — one provider whose `backends` list is the priority
 * order (first entry served first; a backend exhausting its attempt budget
 * falls to the next). A function/namespace plugin (NOT a default-export
 * service): it registers INTO the seam's provider registry; the key is owned
 * by `@deepseek-ai/dsh-vision`.
 *
 * Connection facts resolve per call, layered: the `cordis.yml` entry config
 * under the optional `vision` user-settings section (`ctx.settings`) — the web
 * Vision card edits it, including connectivity-tested, auto-discovered model
 * ids — with each backend's API key resolved through the credential seam. A
 * changed backend list, priority, model, protocol, effort choice, or key
 * reaches the very next describe without a restart. A section with no usable
 * backend parks the provider (registered, but refusing selection) rather than
 * failing the load.
 * @module @deepseek-ai/dsh-vision-qwen
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-vision'
import {
  ANTHROPIC_MIN_THINKING_BUDGET,
  QwenVisionProvider,
  QWEN_BASE_URL_ENV,
  QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
  QWEN_DEFAULT_INSTRUCTION,
  QWEN_DEFAULT_MAX_TOKENS,
  QWEN_DEFAULT_TEMPERATURE,
  QWEN_DEFAULT_TIMEOUT_MS,
  VISION_DEFAULT_PROTOCOL,
} from './provider.ts'
import type { VisionBackendOptions, VisionChainOptions, VisionProtocol } from './provider.ts'
import type { VisionEffortLevel, VisionEffortPreset } from './effort.ts'

export {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MIN_THINKING_BUDGET,
  PIXELS_PER_IMAGE_TOKEN,
  QWEN_BASE_URL_ENV,
  QWEN_DEFAULT_API_KEY_ENV,
  QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
  QWEN_DEFAULT_INSTRUCTION,
  QWEN_DEFAULT_MAX_TOKENS,
  QWEN_DEFAULT_TEMPERATURE,
  QWEN_DEFAULT_TIMEOUT_MS,
  TEXT_CHARS_PER_TOKEN,
  VISION_CHAIN_PROVIDER_ID,
  VISION_DEFAULT_PROTOCOL,
  estimateInputTokens,
  QwenVisionProvider,
  qwenContentText,
} from './provider.ts'
export type { VisionBackendOptions, VisionChainOptions, VisionProtocol } from './provider.ts'
export { MIMO_ON_EFFORT, anthropicEffortFragment, chatEffortFragment, responsesEffortFragment } from './effort.ts'
export type { VisionEffortLevel, VisionEffortOptions, VisionEffortPreset } from './effort.ts'
export { probeImagePixels } from './image-size.ts'
export type { ImagePixels } from './image-size.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'vision-qwen'

/** The vision seam this provider registers into. */
export const inject = ['vision']

/** Upper bound on the chain length; the card enforces the same limit. */
export const VISION_MAX_BACKENDS = 5

/** One vision backend in the priority chain. */
export interface BackendConfig {
  /** Stable id naming this backend in errors and credential references. */
  id: string
  /** Endpoint base; the protocol's path is appended. Falls back to `$QWEN_BASE_URL`. */
  baseURL?: string | undefined
  /** Vision model id the endpoint serves. */
  model?: string | undefined
  /** Credential reference resolved for each describe; defaults to `VISION_<ID>_API_KEY`. */
  apiKeyEnv?: string | undefined
  /** Literal API key; prefer {@link BackendConfig.apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** False parks this backend without reordering the rest. Defaults to true. */
  enabled?: boolean
  /** System instruction for this backend's describe calls. Defaults to the built-in sidecar instruction. */
  instruction?: string
  /** Wire protocol this backend speaks. Defaults to `openai-chat`. */
  protocol?: VisionProtocol
  /** Vendor preset selecting how effort maps onto the wire. Unset sends no effort parameter. */
  effortPreset?: VisionEffortPreset
  /** Effort level; meaningful only with the `openai` preset. */
  effortLevel?: VisionEffortLevel
  /** Effort toggle; meaningful only with the `mimo`, `qwen-local`, and `anthropic` presets. */
  effortEnabled?: boolean
  /** Thinking budget (tokens); meaningful only with the `qwen-local` and `anthropic` presets. */
  thinkingBudget?: number
  /** Advertised context window (tokens); the chain's `maxTokens` must not exceed it. */
  contextTokens?: number
  /** Estimated-input guard (tokens); a describe whose estimate exceeds it is refused before any request. */
  maxInputTokens?: number
}

/** Plugin config (all optional — schemastery fills defaults at load). */
export interface Config {
  /** Backends in priority order (index 0 served first). At most {@link VISION_MAX_BACKENDS}. */
  backends?: BackendConfig[]
  /** Attempts each backend gets before the chain falls to the next priority. */
  attemptsPerBackend?: number
  /** Sampling temperature, within `[0, 2]`. */
  temperature?: number
  /** Completion budget (tokens) for one description. */
  maxTokens?: number
  /** HTTP budget (ms) for one describe attempt. */
  timeoutMs?: number
}

/** Schemastery schema for one backend row; mirrors {@link BackendConfig}. */
const BackendConfigSchema = z.object({
  id: z.string().required(),
  baseURL: z.string(),
  model: z.string(),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  enabled: z.boolean().default(true),
  protocol: z.union(['openai-chat', 'openai-responses', 'anthropic-messages'] as const),
  effortPreset: z.union(['openai', 'mimo', 'qwen-local', 'anthropic'] as const),
  effortLevel: z.string(),
  effortEnabled: z.boolean(),
  thinkingBudget: z.number().step(1).min(1),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputLimitBytes: z.number().step(1).min(1),
  outputLimitChars: z.number().step(1).min(1),
  instruction: z.string(),
})

export const Config = z.object({
  backends: z.array(BackendConfigSchema).default([]),
  attemptsPerBackend: z.number().step(1).min(1).default(QWEN_DEFAULT_ATTEMPTS_PER_BACKEND),
  temperature: z.number().min(0).max(2).default(QWEN_DEFAULT_TEMPERATURE),
  maxTokens: z.number().step(1).min(1).default(QWEN_DEFAULT_MAX_TOKENS),
  timeoutMs: z.number().step(1).min(1).default(QWEN_DEFAULT_TIMEOUT_MS),
})

/** Protocols each effort preset can ride on; any other pairing is rejected. */
const PRESET_PROTOCOLS: Record<VisionEffortPreset, readonly VisionProtocol[]> = {
  openai: ['openai-chat', 'openai-responses'],
  mimo: ['openai-chat', 'openai-responses'],
  'qwen-local': ['openai-chat'],
  anthropic: ['anthropic'],
}

/**
 * Reject a resolved section whose cross-field constraints the schema cannot
 * express: the completion budget must fit each backend's advertised context
 * window, effort fields must match their preset, and the preset must apply to
 * the backend's protocol. Thrown errors fail the settings write (the card
 * keeps the drafts) or the composition load.
 *
 * @param config - the resolved, schema-valid section.
 */
export function validateVisionConfig(config: Config): void {
  const maxTokens = config.maxTokens ?? QWEN_DEFAULT_MAX_TOKENS
  for (const backend of config.backends ?? []) {
    if (backend.contextTokens !== undefined && maxTokens > backend.contextTokens) {
      throw new Error(`vision backend "${backend.id}": maxTokens ${maxTokens} exceeds its context window of ${backend.contextTokens} tokens`)
    }
    if (backend.effortLevel !== undefined && backend.effortPreset !== 'openai') {
      throw new Error(`vision backend "${backend.id}": effortLevel requires effortPreset "openai"`)
    }
    if (backend.effortEnabled !== undefined
      && backend.effortPreset !== 'mimo' && backend.effortPreset !== 'qwen-local' && backend.effortPreset !== 'anthropic') {
      throw new Error(`vision backend "${backend.id}": effortEnabled requires effortPreset "mimo", "qwen-local", or "anthropic"`)
    }
    if (backend.thinkingBudget !== undefined && backend.effortPreset !== 'qwen-local' && backend.effortPreset !== 'anthropic') {
      throw new Error(`vision backend "${backend.id}": thinkingBudget requires effortPreset "qwen-local" or "anthropic"`)
    }
    if (backend.effortPreset !== undefined) {
      const protocol = backend.protocol ?? VISION_DEFAULT_PROTOCOL
      if (!PRESET_PROTOCOLS[backend.effortPreset].includes(protocol)) {
        throw new Error(`vision backend "${backend.id}": effortPreset "${backend.effortPreset}" does not apply to protocol "${protocol}"`)
      }
    }
    if (backend.effortPreset === 'anthropic' && backend.effortEnabled === true) {
      if (backend.thinkingBudget === undefined) {
        throw new Error(`vision backend "${backend.id}": Anthropic extended thinking requires thinkingBudget`)
      }
      if (backend.thinkingBudget < ANTHROPIC_MIN_THINKING_BUDGET) {
        throw new Error(`vision backend "${backend.id}": Anthropic extended thinking needs a thinkingBudget of at least ${ANTHROPIC_MIN_THINKING_BUDGET} tokens`)
      }
      if (backend.thinkingBudget >= maxTokens) {
        throw new Error(`vision backend "${backend.id}": thinkingBudget ${backend.thinkingBudget} must stay below maxTokens ${maxTokens}`)
      }
    }
  }
}

/**
 * Resolve one configured backend into the facts one describe attempt uses.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param backend - the currently authoritative backend config.
 * @returns backend facts for a describe attempt.
 */
export function resolveBackend(ctx: Context, backend: BackendConfig): VisionBackendOptions {
  const apiKeyEnv = credentialRef(backend.apiKeyEnv ?? defaultKeyRef(backend.id))
  const literalApiKey = backend.apiKey !== undefined && backend.apiKey.length > 0
    ? backend.apiKey
    : undefined
  return {
    id: backend.id,
    model: backend.model ?? '',
    baseURL: backend.baseURL ?? launchEnvironmentOf(ctx).get(QWEN_BASE_URL_ENV)?.value ?? '',
    protocol: backend.protocol ?? VISION_DEFAULT_PROTOCOL,
    instruction: backend.instruction ?? QWEN_DEFAULT_INSTRUCTION,
    ...backend.effortPreset !== undefined ? { effortPreset: backend.effortPreset } : {},
    ...backend.effortLevel !== undefined ? { effortLevel: backend.effortLevel } : {},
    ...backend.effortEnabled !== undefined ? { effortEnabled: backend.effortEnabled } : {},
    ...backend.thinkingBudget !== undefined ? { thinkingBudget: backend.thinkingBudget } : {},
    ...backend.maxInputTokens !== undefined ? { maxInputTokens: backend.maxInputTokens } : {},
    resolveApiKey: async () => {
      if (literalApiKey !== undefined) return literalApiKey
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value ?? ''
      // Without the seam the environment is the whole credential plane; an
      // empty answer sends no Authorization header (a keyless local endpoint).
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : ''
    },
  }
}

/**
 * The credential reference a backend uses when its config names none.
 * @param backendId - the backend's stable id.
 * @returns the derived reference name.
 */
export function defaultKeyRef(backendId: string): string {
  return `VISION_${backendId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_API_KEY`
}

/**
 * Project one resolved section into the chain facts the provider serves its
 * next describe with. Environment fallbacks stay here rather than in the
 * provider: every value it reads is already fully defaulted.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns chain facts for a describe call.
 */
export function resolveChain(ctx: Context, config: Config): VisionChainOptions {
  const backends = (config.backends ?? [])
    .slice(0, VISION_MAX_BACKENDS)
    .filter(backend => backend.enabled !== false)
    .map(backend => resolveBackend(ctx, backend))
  return {
    backends,
    attemptsPerBackend: config.attemptsPerBackend ?? QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
    temperature: config.temperature ?? QWEN_DEFAULT_TEMPERATURE,
    maxTokens: config.maxTokens ?? QWEN_DEFAULT_MAX_TOKENS,
    timeoutMs: config.timeoutMs ?? QWEN_DEFAULT_TIMEOUT_MS,
  }
}

/** Register the vision chain provider with `ctx.vision`. */
export function apply(ctx: Context, config: Config): void {
  validateVisionConfig(config)
  ctx.vision.registerProvider(new QwenVisionProvider(() => resolveChain(ctx, config)))
}
