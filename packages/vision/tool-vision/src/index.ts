/**
 * Model-facing `view_image` tool over `ctx.vision`: reads an image file,
 * validates it against the deployment's image policy, and returns the vision
 * model's text description. This package owns the schema, validation, prompt
 * guidance, and presentation, never a concrete vision backend.
 * @module @deepseek-ai/dsh-tool-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import { applyViewImageTool } from './view-image.ts'

export { applyViewImageTool, formatViewImageOutput, imageMediaTypeForPath, parseViewImageArgs } from './view-image.ts'
export type { ViewImageValue } from './view-image.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-vision'

/** Services required by the vision tool suite. */
export const inject = ['tools', 'vision', 'fs', 'systemPrompt']

/**
 * Default cooperative tool-call timeout budget (ms). Comfortably above the
 * Qwen provider's default 60000 ms HTTP budget, so a local vision model's
 * first-token latency cannot lose a race with the tool deadline.
 */
export const DEFAULT_VIEW_IMAGE_TIMEOUT_MS = 120_000

/** Default cap on the complete rendered `view_image` output. */
export const DEFAULT_VIEW_IMAGE_MAX_OUTPUT_CHARS = 8_192

/** Plugin config: the tool-call budget and the rendered output cap. */
export interface Config {
  /** Cooperative timeout budget (ms) for `view_image`. Defaults to 120000. */
  timeoutMs?: number
  /** Cap on complete rendered `view_image` output characters. Defaults to 8192. */
  maxOutputChars?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_VIEW_IMAGE_TIMEOUT_MS),
  maxOutputChars: z.number().default(DEFAULT_VIEW_IMAGE_MAX_OUTPUT_CHARS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Budgeted caps must be positive integers. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-vision: ${name} must be a positive integer`)
  }
}

/**
 * Register the `view_image` tool. The tool is composition-conditional on the
 * attachment service: without a mounted attachment store the deployment has no
 * authoritative image policy to validate bytes against, so the tool never
 * registers.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('maxOutputChars', resolved.maxOutputChars)
  ctx.inject(['attachments'], (imageCtx) => {
    applyViewImageTool(imageCtx, resolved.timeoutMs, resolved.maxOutputChars)
  })
}
