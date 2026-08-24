/**
 * v4Monitor domain contract: DeepSeek V4 Flash live cluster monitoring.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Sampling and generation parameters for an active slot task. */
export interface V4SlotParamsView {
  temp?: number
  top_p?: number
  max_tokens?: number
}

/** Operating state of a model slot. */
export type V4SlotStateView = 'idle' | 'prefilling' | 'decoding'

/** One slot's real-time state in the model server. */
export interface V4SlotView {
  id: number
  state: V4SlotStateView
  task?: number
  n_ctx: number
  prompt_tokens: number
  prompt_processed: number
  prefill_progress: number
  prefill_tps: number
  decode_tps: number
  decoded: number
  n_remain: number
  ctx_usage: number
  speculative?: boolean
  params?: V4SlotParamsView
}

/** One completed historical request entry. */
export interface V4HistoryItemView {
  slot: number
  task: number
  prompt_tokens: number
  decoded: number
  duration_s: number
  decode_tps_avg: number
  end_ts: number
}

/** Model engine status. */
export interface V4EngineView {
  healthy: boolean
  alias: string
  error: string | null
}

/** Complete state snapshot returned by ds-dash. */
export interface V4MonitorStateView {
  ts: number
  engine: V4EngineView
  slots: V4SlotView[]
  history: V4HistoryItemView[]
  age_s: number
  stale: boolean
}

/** v4Monitor unary methods. */
export interface V4MonitorApi {
  /**
   * Fetch current live cluster status of DeepSeek V4 Flash.
   */
  state(request: RpcRequest<{ force?: boolean }>): Promise<RpcResponse<{ state: V4MonitorStateView | null }>>
}
