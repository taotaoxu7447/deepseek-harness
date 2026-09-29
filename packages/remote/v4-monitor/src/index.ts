/**
 * `@deepseek-ai/dsh-v4-monitor`: DeepSeek V4 Flash live cluster monitoring service.
 * @module @deepseek-ai/dsh-v4-monitor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { V4MonitorState } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    v4Monitor: V4MonitorService
  }
}

/** Empty endpoint default: each installation must select its own monitor. */
export const DEFAULT_MONITOR_URL = ''

/** Default polling interval in ms. */
export const DEFAULT_POLL_INTERVAL_MS = 2000

/** Plugin config; every field is volatile so the settings form edits it live. */
export interface Config {
  /** Whether the composer dock is shown. Defaults to false; the sidebar toggle writes this. */
  enabled: Volatile<boolean>
  /** The ds-dash monitor endpoint URL. Empty until the user supplies one. */
  monitorUrl: Volatile<string>
  /** Invite passcode sent in the `X-Dash-Pass` header. Empty until the user supplies one. */
  passcode: Volatile<string>
  /** Polling interval in ms when the dock is shown. Defaults to 2000. */
  pollIntervalMs: Volatile<number>
  /** Whether the dock status bar defaults to collapsed. */
  autoCollapse: Volatile<boolean>
}

export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  monitorUrl: z.string().default(DEFAULT_MONITOR_URL).volatile(),
  passcode: z.string().role('secret').default('').volatile(),
  pollIntervalMs: z.number().min(1000).max(60000).default(DEFAULT_POLL_INTERVAL_MS).volatile(),
  autoCollapse: z.boolean().default(false).volatile(),
})

/** Snapshot of the currently authoritative section. */
export interface ResolvedConfig {
  enabled: boolean
  monitorUrl: string
  passcode: string
  pollIntervalMs: number
  autoCollapse: boolean
}

/**
 * Service managing DeepSeek V4 Flash live state fetches.
 */
export class V4MonitorService extends Service {
  static Config = Config

  private lastState: V4MonitorState | null = null
  private lastFetchedAt = 0

  constructor(ctx: Context, private readonly entry: Config) {
    super(ctx, 'v4Monitor')
  }

  /** Snapshot of the currently authoritative configuration. */
  get config(): ResolvedConfig {
    return {
      enabled: this.entry.enabled.get(),
      monitorUrl: this.entry.monitorUrl.get(),
      passcode: this.entry.passcode.get(),
      pollIntervalMs: this.entry.pollIntervalMs.get(),
      autoCollapse: this.entry.autoCollapse.get(),
    }
  }

  /**
   * Fetch current V4 cluster state from the monitor endpoint.
   * @param force - whether to bypass cache and fetch immediately.
   * @param signal - optional cancellation signal.
   * @returns latest cluster monitoring snapshot, or null if disabled/unreachable.
   */
  async fetchState(force: boolean = false, signal?: AbortSignal): Promise<V4MonitorState | null> {
    const config = this.config
    const passcode = (config.passcode ?? '').trim()
    const monitorUrl = (config.monitorUrl ?? DEFAULT_MONITOR_URL).trim()
    if (monitorUrl === '' || passcode === '') return null

    const now = Date.now()
    if (!force && this.lastState !== null && now - this.lastFetchedAt < 1000) {
      return this.lastState
    }

    const baseUrl = monitorUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/ds-dash/api/state`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Dash-Pass': passcode,
          'Accept': 'application/json',
        },
        signal: signal ?? AbortSignal.timeout(6000),
      })

      if (!response.ok) {
        throw new Error(`ds-dash responded with status ${response.status}`)
      }

      const data = await response.json() as V4MonitorState
      this.lastState = data
      this.lastFetchedAt = Date.now()
      return data
    } catch {
      if (this.lastState) {
        // Return cached with stale flag
        return {
          ...this.lastState,
          stale: true,
        }
      }
      return null
    }
  }

  /**
   * Get the last recorded state.
   * @returns the cached monitoring state snapshot, if any.
   */
  getLastState(): V4MonitorState | null {
    return this.lastState
  }
}

export default V4MonitorService
