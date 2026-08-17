/**
 * vision domain contract: the connectivity probe and model listing behind the
 * web Vision card's backend editor. One call answers both "can I reach this
 * endpoint with this key" and "which model ids does it serve" — the caller
 * never learns a model id it must otherwise hand-copy.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one model a vision endpoint advertises. */
export interface VisionModelView {
  /** Model id the endpoint accepts in a request's `model`. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
}

/** Wire protocols a probed vision endpoint may speak; selects the listing path and auth headers. */
export type VisionDiscoveryProtocol = 'openai-chat' | 'openai-responses' | 'anthropic'

/** Vision-domain unary methods (the map key `vision.discoverModels` of RpcMethodMap). */
export interface VisionApi {
  /**
   * Probe one vision endpoint and list the model ids it serves. `apiKey` is a
   * literal straight from the form draft; `apiKeyEnv` resolves a stored
   * credential server-side — whichever the caller has. Neither is ever
   * returned; failures name the cause (unreachable, refused key, unusable
   * body) without repeating any credential material. `protocol` selects the
   * listing: OpenAI protocols hit `{baseURL}/models`, Anthropic hits
   * `{baseURL}/v1/models` with `x-api-key` and the version header.
   */
  discoverModels(
    request: RpcRequest<{
      baseURL: string
      apiKey?: string
      apiKeyEnv?: string
      protocol?: VisionDiscoveryProtocol
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: VisionModelView[] }>>
}
