/** DeepSeek V4 Flash live cluster monitoring types. */
/** Sampling and generation parameters for an active slot task. */
export interface V4SlotParams {
  temp?: number
  top_p?: number
  max_tokens?: number
}
/** Operating state of a model slot. */
export type V4SlotState = 'idle' | 'prefilling' | 'decoding'
/** One slot's real-time state in the model server. */
export interface V4Slot {
  /** Slot identifier (0, 1, ...). */
  id: number
  /** State of the slot. */
  state: V4SlotState
  /** Task / Request id currently or most recently served. */
  task?: number
  /** Total context capacity (e.g. 262144 tokens). */
  n_ctx: number
  /** Prompt token count for the current request. */
  prompt_tokens: number
  /** Number of prompt tokens processed so far. */
  prompt_processed: number
  /** Prefill progress ratio between 0.0 and 1.0. */
  prefill_progress: number
  /** Real-time prefill processing rate in tokens/s. */
  prefill_tps: number
  /** Real-time decode generation rate in tokens/s. */
  decode_tps: number
  /** Tokens generated so far for the active request. */
  decoded: number
  /** Remaining tokens that can be generated (-1 = unlimited). */
  n_remain: number
  /** Context utilization ratio (prompt_tokens / n_ctx, 0.0 to 1.0). */
  ctx_usage: number
  /** Whether speculative decoding (DSpark) is active. */
  speculative?: boolean
  /** Active request sampling parameters. */
  params?: V4SlotParams
}
/** One completed historical request entry. */
export interface V4HistoryItem {
  /** Slot that executed the task. */
  slot: number
  /** Completed task id. */
  task: number
  /** Total prompt tokens. */
  prompt_tokens: number
  /** Total tokens generated. */
  decoded: number
  /** Duration in seconds. */
  duration_s: number
  /** Overall average decode rate in tokens/s. */
  decode_tps_avg: number
  /** End timestamp (Unix seconds). */
  end_ts: number
}
/** Model engine status. */
export interface V4Engine {
  /** Whether the underlying inference server is healthy. */
  healthy: boolean
  /** Configured model alias (e.g. "deepseek-v4-flash-0731"). */
  alias: string
  /** Error description if engine is unhealthy. */
  error: string | null
}
/** Complete state snapshot returned by ds-dash GET /ds-dash/api/state. */
export interface V4MonitorState {
  /** Metric collection timestamp (Unix seconds). */
  ts: number
  /** Engine health status. */
  engine: V4Engine
  /** Active slots state. */
  slots: V4Slot[]
  /** Recent request execution history. */
  history: V4HistoryItem[]
  /** Seconds elapsed since the last metric collection. */
  age_s: number
  /** Whether data is stale (> 15s since collection). */
  stale: boolean
}
/** One browser-facing snapshot served over the `v4Monitor` Remote namespace. */
export interface V4MonitorSnapshot {
  /** Whether the composer dock is enabled; the sidebar toggle writes this. */
  enabled: boolean
  /** Whether monitorUrl and passcode are both stored; the service never fetches otherwise. */
  configured: boolean
  /** Polling interval in milliseconds the browser should pace its reads with. */
  pollIntervalMs: number
  /** Whether the dock starts collapsed to the compact strip. */
  autoCollapse: boolean
  /** Latest cluster state, or null while unconfigured or before the first successful read. */
  state: V4MonitorState | null
}
//# sourceMappingURL=types.d.ts.map
