/**
 * vision domain contract: the connectivity probe and model listing behind the
 * web Vision card's backend editor. One call answers both "can I reach this
 * endpoint with this key" and "which model ids does it serve" — the caller
 * never learns a model id it must otherwise hand-copy.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one model a vision endpoint advertises. */
export interface VisionModelView {
  /** Model id the endpoint accepts in chat-completions `model`. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
}

/** Vision-domain unary methods (the map key `vision.discoverModels` of RpcMethodMap). */
export interface VisionApi {
  /**
   * Probe one OpenAI-compatible endpoint and list the model ids it serves.
   * `apiKey` is a literal straight from the form draft; `apiKeyEnv` resolves a
   * stored credential server-side — whichever the caller has. Neither is ever
   * returned; failures name the cause (unreachable, refused key, unusable
   * body) without repeating any credential material.
   */
  discoverModels(
    request: RpcRequest<{
      baseURL: string
      apiKey?: string
      apiKeyEnv?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: VisionModelView[] }>>
}
