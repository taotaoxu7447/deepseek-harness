/**
 * `@deepseek-ai/dsh-vision-qwen`: registers the OpenAI-compatible vision
 * chain with `ctx.vision` — one provider whose `backends` list is the priority
 * order (first entry served first; a backend exhausting its attempt budget
 * falls to the next). A function/namespace plugin (NOT a default-export
 * service): it registers INTO the seam's provider registry; the key is owned
 * by `@deepseek-ai/dsh-vision`.
 *
 * Connection facts resolve per call, layered: the `cordis.yml` entry config
 * under the optional `vision` user-settings section (`ctx.settings`) — the web
 * Vision card edits it, including connectivity-tested, auto-discovered model
 * ids — with each backend's API key resolved through the credential seam. A
 * changed backend list, priority, model, or key reaches the very next describe
 * without a restart. A section with no usable backend parks the provider
 * (registered, but refusing selection) rather than failing the load.
 * @module @deepseek-ai/dsh-vision-qwen
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-vision'
import {
  QwenVisionProvider,
  QWEN_BASE_URL_ENV,
  QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
  QWEN_DEFAULT_INSTRUCTION,
  QWEN_DEFAULT_MAX_TOKENS,
  QWEN_DEFAULT_TEMPERATURE,
  QWEN_DEFAULT_TIMEOUT_MS,
} from './provider.ts'
import type { VisionBackendOptions, VisionChainOptions } from './provider.ts'

export {
  QWEN_BASE_URL_ENV,
  QWEN_DEFAULT_API_KEY_ENV,
  QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
  QWEN_DEFAULT_INSTRUCTION,
  QWEN_DEFAULT_MAX_TOKENS,
  QWEN_DEFAULT_TEMPERATURE,
  QWEN_DEFAULT_TIMEOUT_MS,
  VISION_CHAIN_PROVIDER_ID,
  QwenVisionProvider,
} from './provider.ts'
export type { VisionBackendOptions, VisionChainOptions } from './provider.ts'
export { qwenContentText } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'vision-qwen'

/** The vision seam this provider registers into. */
export const inject = ['vision']

/** Settings namespace carrying the backend chain; the web Vision card edits it. */
export const VISION_SETTINGS_NAMESPACE = settingsNamespace('vision')

/** Upper bound on the chain length; the card enforces the same limit. */
export const VISION_MAX_BACKENDS = 5

/** One vision backend in the priority chain. */
export interface BackendConfig {
  /** Stable id naming this backend in errors and credential references. */
  id: string
  /** Endpoint base; `/chat/completions` is appended. Falls back to `$QWEN_BASE_URL`. */
  baseURL?: string
  /** Vision model id the endpoint serves. */
  model?: string
  /** Credential reference resolved for each describe; defaults to `VISION_<ID>_API_KEY`. */
  apiKeyEnv?: string
  /** Literal API key; prefer {@link BackendConfig.apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** False parks this backend without reordering the rest. Defaults to true. */
  enabled?: boolean
  /** System instruction for this backend's describe calls. Defaults to the built-in sidecar instruction. */
  instruction?: string
}

/** Plugin config (all optional — `apply` fills env-var and constant defaults, or the settings section overrides). */
export interface Config {
  /** Backends in priority order (index 0 served first). At most {@link VISION_MAX_BACKENDS}. */
  backends?: BackendConfig[]
  /** Attempts each backend gets before the chain falls to the next priority. Defaults to 2. */
  attemptsPerBackend?: number
  /** Sampling temperature, within `[0, 2]`. Defaults to 0.2. */
  temperature?: number
  /** Completion budget (tokens) for one description. Defaults to 1024. */
  maxTokens?: number
  /** HTTP budget (ms) for one describe attempt. Defaults to 60000. */
  timeoutMs?: number
}

const BackendConfig: z<BackendConfig> = z.object({
  id: z.string(),
  baseURL: z.string(),
  model: z.string(),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  enabled: z.boolean().default(true),
  instruction: z.string(),
})

export const Config: z<Config> = z.object({
  backends: z.array(BackendConfig),
  attemptsPerBackend: z.number().step(1).min(1).default(QWEN_DEFAULT_ATTEMPTS_PER_BACKEND),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().step(1).min(1),
  timeoutMs: z.number().step(1).min(1),
})

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
    instruction: backend.instruction ?? QWEN_DEFAULT_INSTRUCTION,
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
  let current: () => Config = () => config
  installSettingsSection(ctx, VISION_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per describe, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.vision.registerProvider(new QwenVisionProvider(() => resolveChain(ctx, current())))
}
