/**
 * Controller for the official DeepSeek API balance capsule and sidebar toggle:
 * a registrant-private `HostObservable` that reads the `deepseekBalance`
 * Remote namespace only while a framework hook observes it, paced by a
 * one-minute interval, re-read on connection reset, and a toggle verb that
 * writes the entry's stored user section through the Host.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BalanceSnapshot, DeepSeekBalance } from '@deepseek-ai/dsh-api-remotes/client'

/** Poll while a capsule or toggle hook is mounted. */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

/** Snapshot state rendered by the capsule and toggle. */
export interface BalanceState {
  /** Whether the sidebar toggle has turned the capsule on. Defaults on. */
  enabled: boolean
  /** Latest official-API balance, if any. */
  balance: DeepSeekBalance | null
}

/** Live inputs for the balance source. */
export interface BalanceControllerDeps {
  /** Read one snapshot from the Host namespace. */
  readonly read: (force?: boolean) => Promise<RemoteResult<BalanceSnapshot>>
  /** Persist the next toggle state through the Host entry's user section. */
  readonly setEnabled: (enabled: boolean) => Promise<RemoteResult<void>>
  /** Refresh after a connection-generation reset. */
  readonly subscribeReset: (listener: () => void) => () => void
  /** Polling pace; the default is one minute. */
  readonly intervalMs?: number
}

/** Injected face for the composer capsule. */
export interface BalanceCapsuleFace {
  hooks: {
    balance: HostObservable<BalanceState>
  }
}

/** Injected face for the sidebar footer toggle. */
export interface BalanceToggleFace {
  hooks: {
    balance: HostObservable<BalanceState>
  }
  toggleEnabled: () => void
}

function sameState(left: BalanceState, right: BalanceState): boolean {
  return left.enabled === right.enabled && left.balance === right.balance
}

/**
 * Create the balance polling source and its toggle verb. The source polls only
 * while subscribed; disposal is the last unsubscribe.
 * @param deps - Remote read/write faces and the reset subscription.
 * @returns the observable source plus the toggle verb handed to the sidebar.
 */
export function createBalanceController(deps: BalanceControllerDeps): {
  source: HostObservable<BalanceState>
  refresh: (force?: boolean) => Promise<void>
  toggleEnabled: () => void
} {
  let snapshot: BalanceState = { enabled: true, balance: null }
  let subscriptions = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let resetDispose: (() => void) | undefined
  const listeners = new Set<() => void>()

  const publish = (next: BalanceState): void => {
    if (sameState(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const poll = (force = false): void => {
    void deps.read(force).then((result) => {
      if (result.ok) {
        publish({ enabled: result.value.enabled, balance: result.value.balance })
      }
    }, (error: unknown) => {
      console.warn('[ui-deepseek-balance] balance read failed:', error)
    })
  }

  const start = (): void => {
    resetDispose = deps.subscribeReset(() => { poll(true) })
    poll(true)
    timer = setInterval(() => { poll() }, deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  }

  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    resetDispose?.()
    resetDispose = undefined
  }

  const source: HostObservable<BalanceState> = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (subscriptions === 0) start()
      subscriptions++
      return () => {
        listeners.delete(listener)
        subscriptions--
        if (subscriptions === 0) stop()
      }
    },
  }

  return {
    source,
    refresh: async (force = true) => { poll(force) },
    toggleEnabled: () => {
      const next = !snapshot.enabled
      // Optimistic flip; the next poll reconciles with the Host's authority.
      publish({ ...snapshot, enabled: next, balance: next ? snapshot.balance : null })
      void deps.setEnabled(next).then((result) => {
        if (result.ok) poll(true)
        else publish({ ...snapshot, enabled: !next })
      })
    },
  }
}

/**
 * Format an official balance row for the composer capsule.
 * @param data - official API snapshot.
 * @returns a compact currency string.
 */
export function formatBalance(data: DeepSeekBalance): string {
  const amount = Number(data.total)
  const pretty = Number.isFinite(amount) ? amount.toFixed(2) : data.total
  if (data.currency === 'CNY') return `¥${pretty}`
  if (data.currency === 'USD') return `$${pretty}`
  return `${pretty} ${data.currency}`
}
