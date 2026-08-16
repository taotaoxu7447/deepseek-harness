/**
 * Wire schemas for the vision domain: the endpoint probe behind the web Vision
 * card's backend editor.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** Wire schema of one model-discovery probe request. */
export const visionDiscoverModelsRequestSchema = z.object({
  baseURL: z.string().min(1),
  // Write-only at the host: used for this one probe, never stored and never
  // returned. It does ride the client's outgoing envelope like every other
  // secret-bearing payload (`credentials.set`, `settings.update`).
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'vision.discoverModels'>>>

const visionModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
})

/** Wire schema of one model-discovery probe reply. */
export const visionDiscoverModelsValueSchema = z.object({
  models: z.array(visionModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'vision.discoverModels'>>>
