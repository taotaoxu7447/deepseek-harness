/**
 * Wire schemas for the v4Monitor domain: DeepSeek V4 Flash live cluster monitoring.
 */

import { z } from 'zod'
import type { V4EngineView, V4HistoryItemView, V4MonitorStateView, V4SlotView } from './v4-monitor.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

const v4SlotParamsViewSchema = z.object({
  temp: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
})

const v4SlotViewSchema = z.object({
  id: z.number(),
  state: z.union([
    z.literal('idle'),
    z.literal('prefilling'),
    z.literal('decoding'),
  ]),
  task: z.number().optional(),
  n_ctx: z.number(),
  prompt_tokens: z.number(),
  prompt_processed: z.number(),
  prefill_progress: z.number(),
  prefill_tps: z.number(),
  decode_tps: z.number(),
  decoded: z.number(),
  n_remain: z.number(),
  ctx_usage: z.number(),
  speculative: z.boolean().optional(),
  params: v4SlotParamsViewSchema.optional(),
}) satisfies z.ZodType<Wire<V4SlotView>>

const v4HistoryItemViewSchema = z.object({
  slot: z.number(),
  task: z.number(),
  prompt_tokens: z.number(),
  decoded: z.number(),
  duration_s: z.number(),
  decode_tps_avg: z.number(),
  end_ts: z.number(),
}) satisfies z.ZodType<Wire<V4HistoryItemView>>

const v4EngineViewSchema = z.object({
  healthy: z.boolean(),
  alias: z.string(),
  error: z.string().nullable(),
}) satisfies z.ZodType<Wire<V4EngineView>>

const v4MonitorStateViewSchema = z.object({
  ts: z.number(),
  engine: v4EngineViewSchema,
  slots: z.array(v4SlotViewSchema),
  history: z.array(v4HistoryItemViewSchema),
  age_s: z.number(),
  stale: z.boolean(),
}) satisfies z.ZodType<Wire<V4MonitorStateView>>

/** v4Monitor.state request payload. */
export const v4MonitorStateRequestSchema = z.object({
  force: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'v4Monitor.state'>>>

/** v4Monitor.state response value. */
export const v4MonitorStateValueSchema = z.object({
  state: v4MonitorStateViewSchema.nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'v4Monitor.state'>>>
