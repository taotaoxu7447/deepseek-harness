/**
 * `@deepseek-ai/dsh-deepseek-balance`: official DeepSeek API balance proxy.
 * @module @deepseek-ai/dsh-deepseek-balance
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {
  BalanceHistoryStore,
  BalancePeriod,
  BalanceRecord,
  ConsumptionData,
  ConsumptionItem,
  DeepSeekBalance,
} from './types.ts'

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
const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

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
 * Determine pricing period based on Beijing time (UTC+8).
 * Weekends (Saturday & Sunday): All day is Valley -> { period: 'valley', periodLabel: '梁文谷' }
 * Weekdays (Monday to Friday):
 *   Peak hours: 09:00:00 <= time < 12:00:00 or 14:00:00 <= time < 18:00:00 -> { period: 'peak', periodLabel: '梁文峰' }
 *   Valley hours: other weekday times (00:00-09:00, 12:00-14:00, 18:00-24:00) -> { period: 'valley', periodLabel: '梁文谷' }
 */
export function getPeakValleyStatus(date: Date = new Date()): { period: BalancePeriod; periodLabel: string } {
  const utcMilliseconds = date.getTime()
  const beijingTime = new Date(utcMilliseconds + 8 * 60 * 60 * 1000)
  const dayOfWeek = beijingTime.getUTCDay() // 0 = Sunday, 6 = Saturday

  // Weekends are full-day Valley (谷时 / 梁文谷)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      period: 'valley',
      periodLabel: '梁文谷',
    }
  }

  // Weekdays: 09:00-12:00 (32400-43200s) and 14:00-18:00 (50400-64800s) are Peak (峰时 / 梁文峰)
  const hours = beijingTime.getUTCHours()
  const minutes = beijingTime.getUTCMinutes()
  const seconds = beijingTime.getUTCSeconds()
  const totalSeconds = hours * 3600 + minutes * 60 + seconds

  const isMorningPeak = totalSeconds >= 9 * 3600 && totalSeconds < 12 * 3600
  const isAfternoonPeak = totalSeconds >= 14 * 3600 && totalSeconds < 18 * 3600

  if (isMorningPeak || isAfternoonPeak) {
    return {
      period: 'peak',
      periodLabel: '梁文峰',
    }
  }

  return {
    period: 'valley',
    periodLabel: '梁文谷',
  }
}

let inMemoryRecords: BalanceRecord[] = []

function resolveHistoryPath(): string {
  try {
    const home = homedir()
    return join(home, '.deepseek_harness', 'balance_history.json')
  } catch {
    return ''
  }
}

/**
 * Load balance history records from storage or memory fallback.
 */
export function loadBalanceHistory(): BalanceRecord[] {
  if (process.env.VITEST !== undefined) {
    return [...inMemoryRecords]
  }
  const filePath = resolveHistoryPath()
  if (filePath.length === 0) return [...inMemoryRecords]
  try {
    if (!existsSync(filePath)) {
      return [...inMemoryRecords]
    }
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as BalanceHistoryStore
    if (Array.isArray(parsed?.records)) {
      return parsed.records
    }
    return [...inMemoryRecords]
  } catch {
    return [...inMemoryRecords]
  }
}

/**
 * Save balance history records to storage or memory fallback.
 */
export function saveBalanceHistory(records: BalanceRecord[]): void {
  inMemoryRecords = [...records]
  if (process.env.VITEST !== undefined) {
    return
  }
  const filePath = resolveHistoryPath()
  if (filePath.length === 0) return
  try {
    const dir = join(homedir(), '.deepseek_harness')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, JSON.stringify({ records }, null, 2), 'utf-8')
  } catch {
    // Keep in-memory fallback on disk write failure
  }
}

/**
 * Clear in-memory balance records (mainly used in test setups).
 */
export function clearBalanceHistory(): void {
  inMemoryRecords = []
}

/**
 * Aggregate deltas across balance records into daily and monthly consumption items.
 */
export function computeConsumption(records: BalanceRecord[]): ConsumptionData {
  if (records.length < 2) {
    return { daily: [], monthly: [] }
  }

  const dailyMap = new Map<string, { label: string; amount: number }>()
  const monthlyMap = new Map<string, { label: string; amount: number }>()

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]
    const curr = records[i]
    if (!prev || !curr) continue

    if (prev.currency === curr.currency && prev.total > curr.total) {
      const delta = prev.total - curr.total
      const beijingTime = new Date(curr.timestamp + 8 * 60 * 60 * 1000)
      const year = beijingTime.getUTCFullYear()
      const month = beijingTime.getUTCMonth() + 1
      const day = beijingTime.getUTCDate()

      const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const dayLabel = `${month}/${day}`
      const monthKey = `${year}-${String(month).padStart(2, '0')}`
      const monthLabel = `${month}月`

      const existingDaily = dailyMap.get(dayKey)
      if (existingDaily) {
        existingDaily.amount += delta
      } else {
        dailyMap.set(dayKey, { label: dayLabel, amount: delta })
      }

      const existingMonthly = monthlyMap.get(monthKey)
      if (existingMonthly) {
        existingMonthly.amount += delta
      } else {
        monthlyMap.set(monthKey, { label: monthLabel, amount: delta })
      }
    }
  }

  if (dailyMap.size === 0 && monthlyMap.size === 0) {
    return { daily: [], monthly: [] }
  }

  const daily: ConsumptionItem[] = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([key, item]) => ({
      key,
      label: item.label,
      amount: Math.round(item.amount * 10000) / 10000,
    }))

  const monthly: ConsumptionItem[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([key, item]) => ({
      key,
      label: item.label,
      amount: Math.round(item.amount * 10000) / 10000,
    }))

  return { daily, monthly }
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

      const numericTotal = Number.parseFloat(total)
      const history = loadBalanceHistory()
      const cutoff = now - HISTORY_RETENTION_MS
      const updatedHistory = Number.isNaN(numericTotal)
        ? history
        : [
          ...history.filter(r => r.timestamp >= cutoff),
          { timestamp: now, total: numericTotal, currency },
        ]
      if (!Number.isNaN(numericTotal)) {
        saveBalanceHistory(updatedHistory)
      }

      const consumption = computeConsumption(updatedHistory)
      const { period, periodLabel } = getPeakValleyStatus(new Date(now))

      this.lastBalance = {
        currency,
        total,
        available: body.is_available !== false,
        period,
        periodLabel,
        consumption,
      }
      this.lastFetchedAt = Date.now()
      return this.lastBalance
    } catch {
      return this.lastBalance
    }
  }
}

export default DeepSeekBalanceService
