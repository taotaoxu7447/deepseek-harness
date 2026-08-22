/**
 * `@deepseek-ai/dsh-deepseek-balance`: official DeepSeek API balance proxy.
 * @module @deepseek-ai/dsh-deepseek-balance
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { DeepSeekBalance } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deepseekBalance: DeepSeekBalanceService
  }
}

/** Settings namespace carrying the composer balance toggle. */
export const BALANCE_SETTINGS_NAMESPACE = settingsNamespace('deepseek-balance')

/** Official public API used for `/user/balance`. */
export const OFFICIAL_BASE_URL = 'https://api.deepseek.com'

/** Default credential reference for the official DeepSeek route. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** llm-deepseek settings namespace; read only for a custom apiKeyEnv. */
const LLM_DEEPSEEK_NS = settingsNamespace('llm-deepseek')

const CACHE_TTL_MS = 5_000
const FETCH_TIMEOUT_MS = 8_000

/** Configuration for the official balance service. */
export interface Config {
  /** Whether the composer capsule is shown. Defaults to on; the sidebar toggle writes this. */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

interface OfficialBalanceInfo {
  currency?: string
  total_balance?: string
  granted_balance?: string
  topped_up_balance?: string
}

interface OfficialBalanceResponse {
  is_available?: boolean
  balance_infos?: OfficialBalanceInfo[]
}

/**
 * Pick the account's primary official-API row. CNY wins when both exist.
 * @param infos - official `balance_infos` array.
 * @returns the chosen row, or undefined when empty.
 */
function pickBalanceInfo(infos: OfficialBalanceInfo[]): OfficialBalanceInfo | undefined {
  return infos.find(info => info.currency === 'CNY') ?? infos[0]
}

/**
 * Service that resolves the official DeepSeek key and fetches GET /user/balance.
 */
export class DeepSeekBalanceService extends Service {
  static Config: z<Config> = Config

  private current: () => Config
  private lastBalance: DeepSeekBalance | null = null
  private lastFetchedAt = 0

  constructor(ctx: Context, private readonly entry: Config) {
    super(ctx, 'deepseekBalance')
    this.current = () => entry
  }

  protected async [Service.init](): Promise<void> {
    installSettingsSection(this.ctx, BALANCE_SETTINGS_NAMESPACE, Config, this.entry, {
      setSource: (source) => {
        this.current = source
      },
      onChange: () => {},
    })
  }

  /** Current active configuration. */
  get config(): Config {
    return this.current()
  }

  /**
   * Resolve the official DeepSeek API key without exposing it to the browser.
   * @returns the current key, or undefined when none is stored.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    const llm = this.ctx.get('settings')?.get(LLM_DEEPSEEK_NS) as { apiKeyEnv?: string } | undefined
    const envName = llm?.apiKeyEnv?.trim() || DEFAULT_API_KEY_ENV
    try {
      const ref = credentialRef(envName)
      const hit = await this.ctx.get('credentials')?.resolve(ref)
      const value = hit?.value.trim()
      return value === undefined || value.length === 0 ? undefined : value
    } catch {
      return undefined
    }
  }

  /**
   * Fetch the official account balance.
   * @param force - whether to bypass the short TTL cache.
   * @param signal - optional cancellation signal.
   * @returns the current balance, the last good snapshot, or null.
   */
  async fetchBalance(force: boolean = false, signal?: AbortSignal): Promise<DeepSeekBalance | null> {
    const now = Date.now()
    if (!force && this.lastBalance !== null && now - this.lastFetchedAt < CACHE_TTL_MS) {
      return this.lastBalance
    }

    const apiKey = await this.resolveApiKey()
    if (apiKey === undefined) return this.lastBalance

    try {
      const response = await fetch(`${OFFICIAL_BASE_URL}/user/balance`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': 'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness)',
        },
        signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`official balance responded with status ${response.status}`)
      }
      const body = await response.json() as OfficialBalanceResponse
      const info = pickBalanceInfo(body.balance_infos ?? [])
      const total = info?.total_balance?.trim()
      const currency = info?.currency?.trim()
      if (total === undefined || total.length === 0 || currency === undefined || currency.length === 0) {
        return this.lastBalance
      }
      this.lastBalance = {
        currency,
        total,
        available: body.is_available !== false,
      }
      this.lastFetchedAt = Date.now()
      return this.lastBalance
    } catch {
      return this.lastBalance
    }
  }
}

export default DeepSeekBalanceService
