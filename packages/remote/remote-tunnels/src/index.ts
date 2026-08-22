/**
 * `@deepseek-ai/dsh-remote-tunnels`: SSH local-forward tunnels to dsh hosts on
 * other machines, exposed as the `ctx.remoteTunnels` service. Each configured
 * device owns one lifecycle controller: `ssh -N -L
 * <localPort>:127.0.0.1:<remotePort> <sshTarget>` kept alive while the device
 * is wanted, probed over HTTP until the remote dsh web UI answers, restarted
 * with bounded backoff when the process drops unexpectedly, and terminated to
 * quiescence on disconnect or disposal. Authentication never passes through
 * this package: `BatchMode` makes every login non-interactive, so the user's
 * own ssh configuration and agent carry it, and the subprocess seam's
 * environment scrub keeps harness credentials out of the child.
 * @module @deepseek-ai/dsh-remote-tunnels
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteTunnels: RemoteTunnels
  }
}

/** Settings namespace carrying the device roster; the web Remote card edits it. */
export const REMOTE_SETTINGS_NAMESPACE = settingsNamespace('remote')

/** Web port a remote dsh host listens on when a device names no `remotePort`. */
export const DEFAULT_REMOTE_PORT = 3080

/** First loopback port offered to a device that names no `localPort`. */
export const AUTO_LOCAL_PORT_BASE = 13389

/** First delay before respawning a dropped tunnel process. */
export const DEFAULT_RECONNECT_INITIAL_MS = 1000

/** Cap the reconnect backoff never exceeds. */
export const DEFAULT_RECONNECT_MAX_MS = 30_000

/** Delay between two readiness probes of one connecting tunnel. */
export const DEFAULT_PROBE_INTERVAL_MS = 1000

/** HTTP budget of one readiness probe. */
export const DEFAULT_PROBE_TIMEOUT_MS = 4000

/** SIGTERM grace before the subprocess seam escalates to SIGKILL. */
export const DEFAULT_TERMINATE_GRACE_MS = 3000

/** Upper bound on a user-facing state detail line. */
export const DETAIL_MAX_CHARS = 200

/** One remote device in the roster. */
export interface RemoteDeviceConfig {
  /** Stable id naming the device in errors and RPC calls. */
  id: string
  /** Display name; the card falls back to `id` when unset. */
  label?: string
  /** ssh destination — a `~/.ssh/config` alias or `user@host`; host, port, user, and key all live in ssh configuration. */
  sshTarget: string
  /** Web port the remote dsh listens on. Defaults to {@link DEFAULT_REMOTE_PORT}. */
  remotePort?: number
  /** Loopback port the tunnel binds here. Defaults to the next free slot from {@link AUTO_LOCAL_PORT_BASE}. */
  localPort?: number
  /** True connects the tunnel as soon as the roster entry appears. Defaults to false. */
  autoConnect?: boolean
}

/** Plugin config; every key is also valid inside the `remote` settings section. */
export interface Config {
  /** The device roster, in display order. */
  devices?: RemoteDeviceConfig[]
  /** First reconnect delay after an unexpected exit. Defaults to {@link DEFAULT_RECONNECT_INITIAL_MS}. */
  reconnectInitialMs?: number
  /** Reconnect backoff cap. Defaults to {@link DEFAULT_RECONNECT_MAX_MS}. */
  reconnectMaxMs?: number
  /** Delay between readiness probes. Defaults to {@link DEFAULT_PROBE_INTERVAL_MS}. */
  probeIntervalMs?: number
  /** HTTP budget of one readiness probe. Defaults to {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  probeTimeoutMs?: number
  /** SIGTERM grace before SIGKILL. Defaults to {@link DEFAULT_TERMINATE_GRACE_MS}. */
  terminateGraceMs?: number
}

const DeviceConfig: z<RemoteDeviceConfig> = z.object({
  id: z.string(),
  label: z.string(),
  sshTarget: z.string(),
  remotePort: z.natural().min(1).max(65535),
  localPort: z.natural().min(1).max(65535),
  autoConnect: z.boolean().default(false),
})

export const Config: z<Config> = z.object({
  devices: z.array(DeviceConfig).default([]),
  reconnectInitialMs: z.number().step(1).min(50).default(DEFAULT_RECONNECT_INITIAL_MS),
  reconnectMaxMs: z.number().step(1).min(100).default(DEFAULT_RECONNECT_MAX_MS),
  probeIntervalMs: z.number().step(1).min(50).default(DEFAULT_PROBE_INTERVAL_MS),
  probeTimeoutMs: z.number().step(1).min(100).default(DEFAULT_PROBE_TIMEOUT_MS),
  terminateGraceMs: z.number().step(1).min(100).default(DEFAULT_TERMINATE_GRACE_MS),
})

/** The authoritative section with every knob materialized by its declared default. */
export interface LiveConfig {
  /** The device roster, in display order. */
  devices: RemoteDeviceConfig[]
  /** First reconnect delay after an unexpected exit. */
  reconnectInitialMs: number
  /** Reconnect backoff cap. */
  reconnectMaxMs: number
  /** Delay between readiness probes. */
  probeIntervalMs: number
  /** HTTP budget of one readiness probe. */
  probeTimeoutMs: number
  /** SIGTERM grace before SIGKILL. */
  terminateGraceMs: number
}

/**
 * Materialize every knob the schema defaults but the {@link Config} type
 * leaves optional. The composition loader and the settings scope both resolve
 * through the schema, so the fallbacks here fire only for a direct caller
 * that skipped validation.
 * @param config - the currently authoritative section.
 * @returns the section with every timing knob resolved.
 */
export function resolveConfig(config: Config): LiveConfig {
  return {
    devices: config.devices ?? [],
    reconnectInitialMs: config.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS,
    reconnectMaxMs: config.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
    probeIntervalMs: config.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
    probeTimeoutMs: config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    terminateGraceMs: config.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS,
  }
}

/** The one error code callers can receive from this service. */
export type RemoteTunnelErrorCode = 'REMOTE_UNKNOWN_DEVICE'

/** Service failure carrying a machine-readable code for the RPC layer. */
export class RemoteTunnelError extends Error {
  constructor(
    message: string,
    /** Machine-readable failure kind. */
    readonly code: RemoteTunnelErrorCode,
  ) {
    super(message)
    this.name = 'RemoteTunnelError'
  }
}

/** Tunnel lifecycle phases a device view reports. */
export type RemoteTunnelPhase = 'disconnected' | 'connecting' | 'ready' | 'failed'

/** One device's configuration and live tunnel state, as the RPC layer serves it. */
export interface RemoteDeviceView {
  /** The configured id. */
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

/** A roster entry with every default materialized. */
interface ResolvedDevice {
  id: string
  label?: string
  sshTarget: string
  remotePort: number
  localPort: number
  autoConnect: boolean
}

/**
 * One device's lifecycle controller: desired state, observed phase, the live
 * process, and the pending timers. `generation` invalidates every in-flight
 * callback of a superseded connection attempt.
 */
interface DeviceRuntime {
  device: ResolvedDevice
  desired: boolean
  phase: RemoteTunnelPhase
  detail: string | undefined
  handle: SubprocessHandle | undefined
  backoffMs: number
  generation: number
  reconnectCancel: (() => void) | undefined
  probeAbort: AbortController | undefined
  probeLoop: Promise<void> | undefined
}

/**
 * Reject a resolved section whose cross-device constraints the schema cannot
 * express: ids and ssh targets must be non-empty, ids unique, and explicit
 * local ports unique. Thrown errors fail the settings write (the card keeps
 * the drafts) or the composition load.
 *
 * @param config - the resolved, schema-valid section.
 */
export function validateRemoteConfig(config: Config): void {
  const ids = new Set<string>()
  const explicitPorts = new Set<number>()
  for (const device of config.devices ?? []) {
    if (device.id.trim() === '') {
      throw new Error('remote device: id must not be empty')
    }
    if (ids.has(device.id)) {
      throw new Error(`remote device "${device.id}": duplicate id`)
    }
    ids.add(device.id)
    if (device.sshTarget.trim() === '') {
      throw new Error(`remote device "${device.id}": sshTarget must not be empty`)
    }
    if (device.localPort !== undefined) {
      if (explicitPorts.has(device.localPort)) {
        throw new Error(`remote device "${device.id}": localPort ${device.localPort} is assigned to another device`)
      }
      explicitPorts.add(device.localPort)
    }
  }
  const initial = config.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS
  const max = config.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
  if (max < initial) {
    throw new Error(`remote: reconnectMaxMs ${max} is below reconnectInitialMs ${initial}`)
  }
}

/**
 * Project one resolved section into fully-defaulted roster entries. Devices
 * without a `localPort` are assigned consecutive ports from
 * {@link AUTO_LOCAL_PORT_BASE}, skipping every explicitly claimed one, in
 * roster order — so the assignment is deterministic and never collides.
 *
 * @param config - the resolved, {@link validateRemoteConfig}-valid section.
 * @returns the roster in display order.
 */
export function resolveDevices(config: Config): ResolvedDevice[] {
  const claimed = new Set<number>()
  for (const device of config.devices ?? []) {
    if (device.localPort !== undefined) claimed.add(device.localPort)
  }
  let nextAuto = AUTO_LOCAL_PORT_BASE
  return (config.devices ?? []).map((device) => {
    let localPort = device.localPort
    if (localPort === undefined) {
      while (claimed.has(nextAuto)) nextAuto += 1
      localPort = nextAuto
      claimed.add(localPort)
    }
    return {
      id: device.id,
      ...device.label === undefined ? {} : { label: device.label },
      sshTarget: device.sshTarget,
      remotePort: device.remotePort ?? DEFAULT_REMOTE_PORT,
      localPort,
      autoConnect: device.autoConnect ?? false,
    }
  })
}

/**
 * Fatal ssh stderr patterns mapped to their user-facing explanation. A fatal
 * exit never retries: repeating the same spawn cannot fix authentication,
 * host-key trust, name resolution, a malformed forward, or a bound local
 * port. Every message avoids credential material — BatchMode children never
 * see or echo secrets.
 */
const FATAL_EXIT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/permission denied/i, 'authentication failed; BatchMode forbids prompts, so set up key-based login (ssh config IdentityFile/agent) for this target'],
  [/host key verification failed/i, 'host key verification failed; ssh to the target once in a terminal to trust it'],
  [/could not resolve hostname/i, 'the ssh target did not resolve; check the host alias in ssh config'],
  [/bad local forwarding specification/i, 'ssh rejected the forwarding specification'],
  [/cannot listen to port|address already in use/i, 'the local port is already bound by another process'],
]

/**
 * Classify one exited tunnel process by its collected stderr tail.
 *
 * @param stderrTail - the bounded tail the subprocess seam captured.
 * @returns the user-facing fatal reason, or undefined when the exit is
 *   transient and the tunnel should reconnect with backoff.
 */
export function classifyTunnelExit(stderrTail: string): string | undefined {
  for (const [pattern, reason] of FATAL_EXIT_PATTERNS) {
    if (pattern.test(stderrTail)) return reason
  }
  return undefined
}

/** Clip one diagnostic line to the user-facing bound. */
function clipDetail(text: string): string {
  const firstLine = text.trim().split('\n').find(line => line.trim() !== '') ?? ''
  return firstLine.length <= DETAIL_MAX_CHARS ? firstLine : `${firstLine.slice(0, DETAIL_MAX_CHARS - 1)}…`
}

/** The detail line for an unexpected, non-fatal process exit. */
function summarizeExit(outcome: SubprocessOutcome, stderrTail: string): string {
  const fact = outcome.signal === null ? `exit code ${String(outcome.exitCode)}` : `signal ${outcome.signal}`
  const last = clipDetail(stderrTail)
  return last === '' ? `ssh exited unexpectedly (${fact}); reconnecting` : `ssh exited unexpectedly (${fact}): ${last}; reconnecting`
}

/** The detail line for one failed readiness probe. */
function probeDetail(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String(cause.code)
    : undefined
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
    return 'the remote dsh web UI is not answering on the forwarded port; retrying'
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timed out waiting for the remote dsh web UI; retrying'
  }
  return clipDetail(`probe failed: ${error instanceof Error ? error.message : String(error)}; retrying`)
}

/** How one spawned tunnel process settled: exit facts, or the spawn-level failure that never produced them. */
type ProcessSettlement =
  | { readonly kind: 'exit'; readonly outcome: SubprocessOutcome }
  | { readonly kind: 'spawn-error'; readonly error: unknown }

/** Project one runtime into its public view. */
function viewOf(runtime: DeviceRuntime): RemoteDeviceView {
  const { device } = runtime
  return {
    id: device.id,
    ...device.label === undefined ? {} : { label: device.label },
    sshTarget: device.sshTarget,
    remotePort: device.remotePort,
    localPort: device.localPort,
    autoConnect: device.autoConnect,
    tunnel: runtime.phase,
    ...runtime.detail === undefined ? {} : { detail: runtime.detail },
    ...runtime.phase === 'ready' ? { url: `http://127.0.0.1:${device.localPort}/` } : {},
  }
}

/**
 * The remote-device tunnel roster. The composition entry seeds it and the
 * optional `remote` settings section — the web Plugins page's Remote card —
 * overrides it live: every list/connect/disconnect reads the currently
 * authoritative section, and a committed change reconciles without a restart
 * (connection-relevant edits restart that device's tunnel; removals terminate
 * it; label-only edits never touch a live process). With no devices the
 * service idles. Activation fails loud when no `ssh` client is on PATH.
 */
export class RemoteTunnels extends Service {
  static Config: z<Config> = Config

  /** Tunnel processes ride the subprocess capability seam. */
  static inject = ['subprocess']

  private current: () => Config
  private runtimes = new Map<string, DeviceRuntime>()

  constructor(ctx: Context, private readonly entry: Config) {
    super(ctx, 'remoteTunnels')
    this.current = () => entry
  }

  /** Wire the settings section, verify the ssh client exists, and start `autoConnect` devices. */
  async [Service.init](): Promise<void> {
    try {
      await this.ctx.subprocess.resolveExecutable('ssh')
    } catch (error) {
      throw new Error('remote-tunnels: no "ssh" client on PATH; remote devices need the OpenSSH client', { cause: error })
    }
    validateRemoteConfig(this.entry)
    installSettingsSection(this.ctx, REMOTE_SETTINGS_NAMESPACE, Config, this.entry, {
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {
        this.reconcile()
      },
      validate: validateRemoteConfig,
    })
    this.reconcile()
    this.ctx.effect(() => () => this.teardownAll())
  }

  /**
   * Every device's configuration and live tunnel state, in roster order.
   * @returns one view per configured device; `url` is present only while ready.
   */
  list(): RemoteDeviceView[] {
    return [...this.runtimes.values()].map(viewOf)
  }

  /**
   * Mark one device wanted and start its tunnel. Idempotent while a live
   * process exists; from `failed` or a pending backoff it spawns immediately
   * with a fresh backoff budget. The returned view is `connecting`: readiness
   * is observed through {@link list}.
   * @param id - the roster id.
   * @returns the device's current view.
   * @throws RemoteTunnelError synchronously when the id is not configured —
   *   there is nothing to await before that verdict.
   */
  connect(id: string): Promise<RemoteDeviceView> {
    const runtime = this.require(id)
    if (runtime.desired && runtime.handle !== undefined) return Promise.resolve(viewOf(runtime))
    runtime.desired = true
    runtime.backoffMs = this.reconnectInitialMs()
    runtime.reconnectCancel?.()
    runtime.reconnectCancel = undefined
    const generation = runtime.generation + 1
    runtime.generation = generation
    runtime.phase = 'connecting'
    runtime.detail = undefined
    this.spawn(runtime, generation)
    return Promise.resolve(viewOf(runtime))
  }

  /**
   * Mark one device unwanted and take its tunnel down, awaiting the process
   * tree's exit so the loopback port is free when this resolves. Idempotent.
   * @param id - the roster id.
   * @returns the device's current view (`disconnected`).
   */
  async disconnect(id: string): Promise<RemoteDeviceView> {
    const runtime = this.require(id)
    await this.stop(runtime)
    return viewOf(runtime)
  }

  /** The runtime of one roster id, or a loud {@link RemoteTunnelError}. */
  private require(id: string): DeviceRuntime {
    const runtime = this.runtimes.get(id)
    if (runtime === undefined) {
      throw new RemoteTunnelError(`remote device "${id}" is not configured`, 'REMOTE_UNKNOWN_DEVICE')
    }
    return runtime
  }

  /** The authoritative section with every timing knob materialized. */
  private live(): LiveConfig {
    return resolveConfig(this.current())
  }

  private reconnectInitialMs(): number {
    return this.live().reconnectInitialMs
  }

  private reconnectMaxMs(): number {
    return this.live().reconnectMaxMs
  }

  /** Diff the authoritative section into runtimes: add, retain, restart, or terminate. */
  private reconcile(): void {
    const devices = resolveDevices(this.current())
    const previous = this.runtimes
    const staged: Array<{ device: ResolvedDevice; runtime: DeviceRuntime; fresh: boolean }> = []
    const next = new Map<string, DeviceRuntime>()
    for (const device of devices) {
      const existing = previous.get(device.id)
      const runtime: DeviceRuntime = existing ?? {
        device,
        desired: false,
        phase: 'disconnected',
        detail: undefined,
        handle: undefined,
        backoffMs: this.reconnectInitialMs(),
        generation: 0,
        reconnectCancel: undefined,
        probeAbort: undefined,
        probeLoop: undefined,
      }
      next.set(device.id, runtime)
      staged.push({ device, runtime, fresh: existing === undefined })
    }
    for (const [id, runtime] of previous) {
      if (!next.has(id)) void this.stop(runtime)
    }
    // Publish the new map before any connect: `connect` resolves ids through it.
    this.runtimes = next
    for (const { device, runtime, fresh } of staged) {
      if (fresh) {
        if (device.autoConnect) void this.connect(device.id)
        continue
      }
      const connectionChanged = runtime.device.sshTarget !== device.sshTarget
        || runtime.device.remotePort !== device.remotePort
        || runtime.device.localPort !== device.localPort
      if (connectionChanged) {
        void this.restart(runtime, device)
      } else {
        runtime.device = device
        if (device.autoConnect && !runtime.desired) void this.connect(device.id)
      }
    }
  }

  /** Swap one device's connection facts, preserving whether it was wanted. */
  private async restart(runtime: DeviceRuntime, device: ResolvedDevice): Promise<void> {
    const reconnect = runtime.desired || device.autoConnect
    await this.stop(runtime)
    runtime.device = device
    if (reconnect) await this.connect(device.id)
  }

  /** Spawn the forward process and open the probe loop. Precondition: no live handle. */
  private spawn(runtime: DeviceRuntime, generation: number): void {
    const { device } = runtime
    const handle = this.ctx.subprocess.spawn({
      argv: [
        'ssh', '-N', '-T',
        '-o', 'BatchMode=yes',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2',
        '-L', `${device.localPort}:127.0.0.1:${device.remotePort}`,
        device.sshTarget,
      ],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1024 },
        stderr: { maxBytes: 4096 },
      },
      graceMs: this.live().terminateGraceMs,
    })
    runtime.handle = handle
    runtime.phase = 'connecting'
    handle.done.then(
      (outcome) => { this.onExit(runtime, generation, handle, { kind: 'exit', outcome }) },
      (error: unknown) => { this.onExit(runtime, generation, handle, { kind: 'spawn-error', error }) },
    )
    const probeAbort = new AbortController()
    runtime.probeAbort = probeAbort
    runtime.probeLoop = this.probe(runtime, generation, probeAbort.signal)
  }

  /**
   * Probe the forwarded port until the remote dsh web UI answers. The loop
   * never rejects: every outcome lands in the runtime's phase/detail, and any
   * superseded generation exits quietly.
   */
  private async probe(runtime: DeviceRuntime, generation: number, abort: AbortSignal): Promise<void> {
    const probeTimeoutMs = this.live().probeTimeoutMs
    const probeIntervalMs = this.live().probeIntervalMs
    // Read the staleness facts through a closure: a direct `abort.aborted` /
    // generation guard would be narrowed "always false" after its first check
    // (property narrowing survives awaits), hiding that both genuinely change
    // across every await in this loop.
    const superseded = (): boolean => abort.aborted || runtime.generation !== generation
    for (;;) {
      if (superseded()) return
      try {
        const response = await fetch(`http://127.0.0.1:${runtime.device.localPort}/`, {
          signal: AbortSignal.any([abort, AbortSignal.timeout(probeTimeoutMs)]),
        })
        // Discard-only drain: a cancel failure means the stream already errored, and nothing else reads it.
        await response.body?.cancel().catch(() => undefined)
        if (superseded()) return
        if (response.status >= 200 && response.status < 300) {
          runtime.phase = 'ready'
          runtime.detail = undefined
          runtime.backoffMs = this.reconnectInitialMs()
          return
        }
        runtime.detail = `the remote endpoint answered HTTP ${String(response.status)}, not the dsh web UI; retrying`
      } catch (error) {
        if (superseded()) return
        runtime.detail = probeDetail(error)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, probeIntervalMs)
        abort.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
  }

  /** Fold one process settlement into the state machine. */
  private onExit(
    runtime: DeviceRuntime,
    generation: number,
    handle: SubprocessHandle,
    settlement: ProcessSettlement,
  ): void {
    if (runtime.generation !== generation) return
    runtime.handle = undefined
    runtime.probeAbort?.abort()
    // `desired` is necessarily still true here: the only clearer (stop) also
    // bumps the generation, which the guard above already caught.
    if (settlement.kind === 'spawn-error') {
      runtime.phase = 'failed'
      runtime.detail = clipDetail(`ssh failed to start: ${settlement.error instanceof Error ? settlement.error.message : String(settlement.error)}`)
      return
    }
    const stderrTail = handle.collected.stderr?.readFrom(0).text ?? ''
    const fatal = classifyTunnelExit(stderrTail)
    if (fatal !== undefined) {
      runtime.phase = 'failed'
      runtime.detail = fatal
      return
    }
    runtime.phase = 'connecting'
    runtime.detail = summarizeExit(settlement.outcome, stderrTail)
    const delay = runtime.backoffMs
    runtime.backoffMs = Math.min(runtime.backoffMs * 2, this.reconnectMaxMs())
    const { promise, resolve } = Promise.withResolvers<void>()
    const timer = setTimeout(resolve, delay)
    runtime.reconnectCancel = () => {
      clearTimeout(timer)
      resolve()
    }
    void promise.then(() => {
      runtime.reconnectCancel = undefined
      if (runtime.generation !== generation) return
      this.spawn(runtime, generation)
    })
  }

  /** Take one device's tunnel down to quiescence: timers cancelled, probe loop settled, process tree exited. */
  private async stop(runtime: DeviceRuntime): Promise<void> {
    runtime.desired = false
    runtime.generation += 1
    runtime.reconnectCancel?.()
    runtime.reconnectCancel = undefined
    runtime.probeAbort?.abort()
    runtime.probeAbort = undefined
    const probeLoop = runtime.probeLoop
    runtime.probeLoop = undefined
    const handle = runtime.handle
    runtime.handle = undefined
    runtime.phase = 'disconnected'
    runtime.detail = undefined
    runtime.backoffMs = this.reconnectInitialMs()
    if (probeLoop !== undefined) await probeLoop
    if (handle !== undefined) {
      handle.terminate()
      const graceMs = this.live().terminateGraceMs
      const exited = await handle.waitForExit(AbortSignal.timeout(graceMs + 1000))
      if (!exited) {
        this.ctx.logger.warn(`remote-tunnels: tunnel process ${String(handle.pid)} for "${runtime.device.id}" outlived its termination escalation`)
      }
    }
  }

  /** Terminate every tunnel and await every exit; registered as the service's unload effect. */
  private async teardownAll(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map(runtime => this.stop(runtime)))
  }
}

export default RemoteTunnels
