/**
 * Controller for the V4 cluster monitor dock and sidebar toggle: a
 * registrant-private `HostObservable` that reads the `v4Monitor` Remote
 * namespace only while a framework hook observes it, paced by the Host's
 * configured poll interval, re-read on connection reset, plus a collapse
 * verb (local UI state seeded from the Host's autoCollapse) and a toggle
 * verb that writes the entry's stored user section through the Host.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { V4MonitorSnapshot, V4MonitorState } from '@deepseek-ai/dsh-api-remotes/client'

/** Poll while a dock or toggle hook is mounted, before the Host reports its own interval. */
export const DEFAULT_POLL_INTERVAL_MS = 2000

/** Snapshot state rendered by the V4MonitorDock component. */
export interface V4MonitorDockState {
  /** Whether the sidebar toggle has turned the dock on. */
  enabled: boolean
  /** Whether the dock is collapsed to a compact one-line strip. */
  collapsed: boolean
  /** Latest live monitoring snapshot. */
  data: V4MonitorState | null
  /** Polling interval in ms. */
  pollIntervalMs: number
}

/** Injected face for the composer dock. */
export interface V4MonitorDockFace {
  hooks: {
    v4Dock: HostObservable<V4MonitorDockState>
  }
  toggleCollapse: () => void
  refresh: () => Promise<void>
}

/** Injected face for the sidebar footer toggle. */
export interface V4MonitorToggleFace {
  hooks: {
    v4Dock: HostObservable<V4MonitorDockState>
  }
  toggleEnabled: () => void
}

/** Live inputs for the dock source. */
export interface V4MonitorControllerDeps {
  /** Read one snapshot from the Host namespace. */
  readonly read: (force?: boolean) => Promise<RemoteResult<V4MonitorSnapshot>>
  /** Persist the next toggle state through the Host entry's user section. */
  readonly setEnabled: (enabled: boolean) => Promise<RemoteResult<void>>
  /** Refresh after a connection-generation reset. */
  readonly subscribeReset: (listener: () => void) => () => void
}

function sameState(left: V4MonitorDockState, right: V4MonitorDockState): boolean {
  return left.enabled === right.enabled && left.collapsed === right.collapsed
    && left.data === right.data && left.pollIntervalMs === right.pollIntervalMs
}

/**
 * Create the dock polling source and its verbs. The source polls only while
 * subscribed; the interval re-arms whenever the Host reports a new one.
 * @param deps - Remote read/write faces and the reset subscription.
 * @returns the observable source plus the collapse, refresh, and toggle verbs.
 */
export function createV4MonitorController(deps: V4MonitorControllerDeps): {
  source: HostObservable<V4MonitorDockState>
  toggleCollapse: () => void
  refresh: () => Promise<void>
  toggleEnabled: () => void
} {
  let snapshot: V4MonitorDockState = {
    enabled: false,
    collapsed: false,
    data: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  }
  let subscriptions = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let intervalMs = DEFAULT_POLL_INTERVAL_MS
  let autoCollapseSeen = false
  let resetDispose: (() => void) | undefined
  const listeners = new Set<() => void>()

  const publish = (next: V4MonitorDockState): void => {
    if (sameState(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const schedule = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = setInterval(() => { poll() }, intervalMs)
  }

  const poll = (force = false): void => {
    void deps.read(force).then((result) => {
      if (!result.ok) return
      const { enabled, state, pollIntervalMs, autoCollapse } = result.value
      intervalMs = Math.max(1000, pollIntervalMs)
      const collapsed = autoCollapseSeen ? snapshot.collapsed : autoCollapse
      autoCollapseSeen = true
      publish({
        enabled,
        collapsed,
        data: enabled ? state : null,
        pollIntervalMs: intervalMs,
      })
      schedule()
    }, (error: unknown) => {
      console.warn('[ui-v4-monitor] cluster state read failed:', error)
    })
  }

  const start = (): void => {
    resetDispose = deps.subscribeReset(() => { poll(true) })
    poll(true)
  }

  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    resetDispose?.()
    resetDispose = undefined
    autoCollapseSeen = false
  }

  const source: HostObservable<V4MonitorDockState> = {
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
    toggleCollapse: () => {
      publish({ ...snapshot, collapsed: !snapshot.collapsed })
    },
    refresh: async () => { poll(true) },
    toggleEnabled: () => {
      const next = !snapshot.enabled
      // Optimistic flip; the next poll reconciles with the Host's authority.
      publish({ ...snapshot, enabled: next, data: next ? snapshot.data : null })
      void deps.setEnabled(next).then((result) => {
        if (result.ok) poll(true)
        else publish({ ...snapshot, enabled: !next })
      })
    },
  }
}
