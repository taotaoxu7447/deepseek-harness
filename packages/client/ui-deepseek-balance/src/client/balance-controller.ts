/**
 * Controller for the official DeepSeek API balance capsule and sidebar toggle.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { BalanceView } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Namespace for the composer balance toggle. */
export const BALANCE_NS = 'deepseek-balance'

/** Poll while a composer capsule is mounted. */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

/** Stored configuration for the balance settings section. */
export interface BalanceSettings {
  enabled?: boolean
}

/** Snapshot state rendered by the capsule and toggle. */
export interface BalanceState {
  /** Whether the sidebar toggle has turned the capsule on. Defaults on. */
  enabled: boolean
  /** Latest official-API balance, if any. */
  data: BalanceView | null
}

/** Injected face for the composer capsule. */
export interface BalanceCapsuleFace {
  hooks: {
    balance: SnapshotStore<BalanceState>
  }
}

/** Injected face for the sidebar footer toggle. */
export interface BalanceToggleFace {
  hooks: {
    balance: SnapshotStore<BalanceState>
  }
  toggleEnabled: () => void
}

/**
 * Format an official balance row for the composer capsule.
 * @param data - official API snapshot.
 * @returns a compact currency string.
 */
export function formatBalance(data: BalanceView): string {
  const amount = Number(data.total)
  const pretty = Number.isFinite(amount) ? amount.toFixed(2) : data.total
  if (data.currency === 'CNY') return `¥${pretty}`
  if (data.currency === 'USD') return `$${pretty}`
  return `${pretty} ${data.currency}`
}

/** Controller managing official-API balance polling and capsule visibility. */
export class BalanceController {
  private readonly store: SnapshotStore<BalanceState>
  private settings: BalanceSettings = {}
  private data: BalanceView | null = null
  private timer: number | undefined
  private liveSubscribers = 0

  /**
   * @param scope - The settings scope binding the deepseek-balance namespace.
   * @param api - Client API face for RPC requests.
   */
  constructor(
    private readonly scope: SettingsScope<BalanceSettings>,
    private readonly api: Pick<IApiClient, 'balance'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.reseed()
    scope.subscribe(() => { this.reseed() })
  }

  private reseed(): void {
    const snap = this.scope.getSnapshot()
    this.settings = snap.value ?? {}
    this.store.set(this.projection())
    this.checkPolling()
  }

  private isEnabled(): boolean {
    return this.settings.enabled !== false
  }

  private projection(): BalanceState {
    const enabled = this.isEnabled()
    return {
      enabled,
      data: enabled ? this.data : null,
    }
  }

  private checkPolling(): void {
    const shouldPoll = this.isEnabled() && this.liveSubscribers > 0
    if (shouldPoll && this.timer === undefined) {
      void this.pollOnce()
      this.timer = setInterval(() => { void this.pollOnce() }, DEFAULT_POLL_INTERVAL_MS) as unknown as number
    } else if (!shouldPoll && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /**
   * Execute one poll cycle against the Host official-API proxy.
   * @param force - Whether to bypass the Host short TTL cache.
   */
  async pollOnce(force = false): Promise<void> {
    try {
      const res = await this.api.balance.get({ force })
      if (res?.result?.ok) {
        this.data = res.result.value.balance
        this.store.set(this.projection())
      }
    } catch {
      // Keep cached state
    }
  }

  /**
   * Toggle whether the composer capsule is shown.
   */
  toggleEnabled(): void {
    void this.scope.set('enabled', !this.isEnabled())
  }

  private subscribeLive(listener: () => void): () => void {
    this.liveSubscribers += 1
    this.checkPolling()
    const off = this.store.subscribe(listener)
    return () => {
      this.liveSubscribers = Math.max(0, this.liveSubscribers - 1)
      this.checkPolling()
      off()
    }
  }

  private liveStore(): SnapshotStore<BalanceState> {
    return {
      getSnapshot: () => this.store.getSnapshot(),
      set: state => this.store.set(state),
      update: updater => this.store.update(updater),
      subscribe: listener => this.subscribeLive(listener),
    }
  }

  /**
   * Build the face injected into the composer capsule.
   * @returns Injected face that starts polling while mounted.
   */
  injectCapsule(): BalanceCapsuleFace {
    return {
      hooks: { balance: this.liveStore() },
    }
  }

  /**
   * Build the face injected into the sidebar footer toggle.
   * @returns Injected face that only reads enabled state.
   */
  injectToggle(): BalanceToggleFace {
    return {
      hooks: { balance: this.store },
      toggleEnabled: () => { this.toggleEnabled() },
    }
  }

  /**
   * Stop polling and dispose allocated timer resources.
   */
  dispose(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
