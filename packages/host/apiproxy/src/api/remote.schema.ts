/**
 * Wire schemas for the remote domain: the device roster and tunnel lifecycle
 * behind the web Remote card.
 */

import { z } from 'zod'
import type { RemoteDeviceView } from './remote.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** Wire schema of one remote-device row. */
const remoteDeviceViewSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  sshTarget: z.string().min(1),
  remotePort: z.number().int().min(1).max(65535),
  localPort: z.number().int().min(1).max(65535),
  autoConnect: z.boolean(),
  tunnel: z.union([
    z.literal('disconnected'),
    z.literal('connecting'),
    z.literal('ready'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  url: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RemoteDeviceView>>

/** remote.list request payload. */
export const remoteListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'remote.list'>>>

/** remote.list response value. */
export const remoteListValueSchema = z.object({
  devices: z.array(remoteDeviceViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'remote.list'>>>

/** remote.connect request payload. */
export const remoteConnectRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'remote.connect'>>>

/** remote.connect response value. */
export const remoteConnectValueSchema = z.object({
  device: remoteDeviceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'remote.connect'>>>

/** remote.disconnect request payload. */
export const remoteDisconnectRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'remote.disconnect'>>>

/** remote.disconnect response value. */
export const remoteDisconnectValueSchema = z.object({
  device: remoteDeviceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'remote.disconnect'>>>
