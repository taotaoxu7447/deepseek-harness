/**
 * Controller for the Local V4 cluster monitor dock and sidebar toggle.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { V4MonitorStateView } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Namespace for local V4 settings. */
export const LOCAL_V4_NS = 'local-v4'

/** Stored configuration for the local V4 settings section. */
export interface LocalV4Settings {
  enabled?: boolean
  monitorUrl?: string
  passcode?: string
  pollIntervalMs?: number
  autoCollapse?: boolean
}

/** Snapshot state rendered by the V4MonitorDock component. */
export interface V4MonitorDockState {
  /** Whether the sidebar toggle has turned the dock on. */
  enabled: boolean
  /** Whether the dock is collapsed to a compact one-line strip. */
  collapsed: boolean
  /** Latest live monitoring snapshot. */
  data: V4MonitorStateView | null
  /** Polling interval in ms. */
  pollIntervalMs: number
}

/** Injected face for the composer dock. */
export interface V4MonitorDockFace {
  hooks: {
    v4Dock: SnapshotStore<V4MonitorDockState>
  }
  toggleCollapse: () => void
  refresh: () => Promise<void>
}

/** Injected face for the sidebar footer toggle. */
export interface V4MonitorToggleFace {
  hooks: {
    v4Dock: SnapshotStore<V4MonitorDockState>
  }
  toggleEnabled: () => void
}

/** Controller managing live cluster monitoring polling and dock visibility. */
export class V4MonitorController {
  private readonly store: SnapshotStore<V4MonitorDockState>
  private settings: LocalV4Settings = {}
  private data: V4MonitorStateView | null = null
  private collapsed = false
  private timer: number | undefined
  private activeSubscribers = 0

  /**
   * @param scope - The settings scope binding the local-v4 namespace.
   * @param api - Client API face for RPC requests.
   */
  constructor(
    private readonly scope: SettingsScope<LocalV4Settings>,
    private readonly api: Pick<IApiClient, 'v4Monitor'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.reseed()
    scope.subscribe(() => { this.reseed() })
  }

  private reseed(): void {
    const snap = this.scope.getSnapshot()
    this.settings = snap.value ?? {}
    if (this.settings.autoCollapse !== undefined) {
      this.collapsed = this.settings.autoCollapse
    }
    this.store.set(this.projection())
    this.checkPolling()
  }

  private isEnabled(): boolean {
    return this.settings.enabled === true
  }

  private projection(): V4MonitorDockState {
    const enabled = this.isEnabled()
    return {
      enabled,
      collapsed: this.collapsed,
      data: enabled ? this.data : null,
      pollIntervalMs: this.settings.pollIntervalMs ?? 2000,
    }
  }

  private checkPolling(): void {
    const shouldPoll = this.isEnabled() && this.activeSubscribers > 0
    if (shouldPoll && !this.timer) {
      void this.pollOnce()
      const interval = Math.max(1000, this.settings.pollIntervalMs ?? 2000)
      this.timer = setInterval(() => { void this.pollOnce() }, interval) as unknown as number
    } else if (!shouldPoll && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /**
   * Execute one poll cycle to refresh live cluster status.
   * @param force - Whether to force a fresh request bypassing short TTL cache.
   */
  async pollOnce(force = false): Promise<void> {
    try {
      const res = await this.api.v4Monitor.state({ force })
      if (res?.result?.ok) {
        this.data = res.result.value.state
        this.store.set(this.projection())
      }
    } catch {
      // Keep cached state
    }
  }

  /**
   * Toggle whether the composer dock is shown. Persists through the settings section.
   */
  toggleEnabled(): void {
    void this.scope.set('enabled', !this.isEnabled())
  }

  private subscribeDock(listener: () => void): () => void {
    this.activeSubscribers += 1
    this.checkPolling()
    const off = this.store.subscribe(listener)
    return () => {
      this.activeSubscribers = Math.max(0, this.activeSubscribers - 1)
      this.checkPolling()
      off()
    }
  }

  private dockStore(): SnapshotStore<V4MonitorDockState> {
    return {
      getSnapshot: () => this.store.getSnapshot(),
      set: state => this.store.set(state),
      update: updater => this.store.update(updater),
      subscribe: listener => this.subscribeDock(listener),
    }
  }

  /**
   * Build the face injected into the V4MonitorDock component.
   * @returns Injected face containing dock hooks and collapse toggle.
   */
  injectDock(): V4MonitorDockFace {
    return {
      hooks: { v4Dock: this.dockStore() },
      toggleCollapse: () => {
        this.collapsed = !this.collapsed
        this.store.set(this.projection())
      },
      refresh: () => this.pollOnce(true),
    }
  }

  /**
   * Build the face injected into the sidebar footer toggle.
   * @returns Injected face containing dock hooks and enable toggle.
   */
  injectToggle(): V4MonitorToggleFace {
    return {
      hooks: { v4Dock: this.dockStore() },
      toggleEnabled: () => { this.toggleEnabled() },
    }
  }

  /**
   * Stop polling and dispose allocated timer resources.
   */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
