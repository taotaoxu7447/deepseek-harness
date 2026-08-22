/**
 * Wire schemas for the balance domain: official DeepSeek API account balance.
 */

import { z } from 'zod'
import type { BalanceView } from './balance.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

const balanceViewSchema = z.object({
  currency: z.string(),
  total: z.string(),
  available: z.boolean(),
}) satisfies z.ZodType<Wire<BalanceView>>

/** balance.get request payload. */
export const balanceGetRequestSchema = z.object({
  force: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'balance.get'>>>

/** balance.get response value. */
export const balanceGetValueSchema = z.object({
  balance: balanceViewSchema.nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'balance.get'>>>
