/**
 * `@deepseek-ai/dsh-v4-monitor`: DeepSeek V4 Flash live cluster monitoring service.
 * @module @deepseek-ai/dsh-v4-monitor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { V4MonitorState } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    v4Monitor: V4MonitorService
  }
}

/** Settings namespace carrying the Local V4 monitor settings. */
export const LOCAL_V4_SETTINGS_NAMESPACE = settingsNamespace('local-v4')

/** Empty endpoint default: each installation must select its own monitor. */
export const DEFAULT_MONITOR_URL = ''

/** Default polling interval in ms. */
export const DEFAULT_POLL_INTERVAL_MS = 2000

/** Configuration for the local V4 monitor service. */
export interface Config {
  /** Whether the composer dock is shown. Defaults to false; the sidebar toggle writes this. */
  enabled?: boolean
  /** The ds-dash monitor endpoint URL. Empty until the user supplies one. */
  monitorUrl?: string
  /** Invite passcode sent in the `X-Dash-Pass` header. Empty until the user supplies one. */
  passcode?: string
  /** Polling interval in ms when the dock is shown. Defaults to 2000. */
  pollIntervalMs?: number
  /** Whether the dock status bar defaults to collapsed. */
  autoCollapse?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  monitorUrl: z.string().default(DEFAULT_MONITOR_URL),
  passcode: z.string().role('secret').default(''),
  pollIntervalMs: z.number().min(1000).max(60000).default(DEFAULT_POLL_INTERVAL_MS),
  autoCollapse: z.boolean().default(false),
})

/**
 * Service managing DeepSeek V4 Flash live state fetches.
 */
export class V4MonitorService extends Service {
  static Config: z<Config> = Config

  private current: () => Config
  private lastState: V4MonitorState | null = null
  private lastFetchedAt = 0

  constructor(ctx: Context, private readonly entry: Config) {
    super(ctx, 'v4Monitor')
    this.current = () => entry
  }

  protected [Service.init](): Promise<void> {
    installSettingsSection(this.ctx, LOCAL_V4_SETTINGS_NAMESPACE, Config, this.entry, {
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {},
    })
    return Promise.resolve()
  }

  /** Current active configuration. */
  get config(): Config {
    return this.current()
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
