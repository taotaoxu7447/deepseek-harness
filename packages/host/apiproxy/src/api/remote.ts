/**
 * remote domain contract: the device roster and SSH-tunnel lifecycle behind
 * the web Remote card. The wire view is the tunnel service's own
 * `RemoteDeviceView` re-declared: api/ must stay browser-importable with zero
 * host-package dependencies, and the structural match is enforced by the
 * value schema's `satisfies Wire<...>` anchor on both sides.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Tunnel lifecycle phases a device view reports. */
export type RemoteTunnelPhase = 'disconnected' | 'connecting' | 'ready' | 'failed'

/** Wire view of one remote device and its tunnel state. */
export interface RemoteDeviceView {
  /** The configured roster id. */
  id: string
  /** The configured display name, when set. */
  label?: string
  /** The configured ssh destination. */
  sshTarget: string
  /** The remote dsh web port the tunnel forwards to. */
  remotePort: number
  /** The loopback port the tunnel binds here. */
  localPort: number
  /** Whether the tunnel connects as soon as its roster entry appears. */
  autoConnect: boolean
  /** Current lifecycle phase. */
  tunnel: RemoteTunnelPhase
  /** Human-readable failure or progress line for `connecting`/`failed`; free of credential material. */
  detail?: string
  /** The tunneled UI address, present only while `ready`. */
  url?: string
}

/** Remote-domain unary methods (the map keys `remote.*` of RpcMethodMap). */
export interface RemoteApi {
  /**
   * List every configured device with its live tunnel state, in roster order.
   * `url` is present only on `ready` rows. With the tunnel service absent
   * from the composition, the list is empty — the roster itself lives in the
   * `remote` settings section.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ devices: RemoteDeviceView[] }>>

  /**
   * Start one device's tunnel. The returned view is `connecting`: readiness
   * is observed through `list`. An unknown id fails with
   * `remote-tunnel-failed`.
   */
  connect(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ device: RemoteDeviceView }>>

  /**
   * Take one device's tunnel down, resolving only after the process tree has
   * exited and the loopback port is free. Idempotent; an unknown id fails
   * with `remote-tunnel-failed`.
   */
  disconnect(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ device: RemoteDeviceView }>>
}
