/**
 * Wire schemas for the balance domain: official DeepSeek API account balance.
 */

import { z } from 'zod'
import type { BalancePeriod, BalanceView, ConsumptionData, ConsumptionItem } from './balance.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

export const balancePeriodSchema = z.enum(['peak', 'valley']) satisfies z.ZodType<Wire<BalancePeriod>>

export const consumptionItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  amount: z.number(),
}) satisfies z.ZodType<Wire<ConsumptionItem>>

export const consumptionDataSchema = z.object({
  daily: z.array(consumptionItemSchema),
  monthly: z.array(consumptionItemSchema),
}) satisfies z.ZodType<Wire<ConsumptionData>>

export const balanceViewSchema = z.object({
  currency: z.string(),
  total: z.string(),
  available: z.boolean(),
  period: balancePeriodSchema,
  periodLabel: z.string(),
  consumption: consumptionDataSchema,
}) satisfies z.ZodType<Wire<BalanceView>>

/** balance.get request payload. */
export const balanceGetRequestSchema = z.object({
  force: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'balance.get'>>>

/** balance.get response value. */
export const balanceGetValueSchema = z.object({
  balance: balanceViewSchema.nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'balance.get'>>>
