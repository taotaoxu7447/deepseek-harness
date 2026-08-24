/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * One remote Harness surface shown inside the window as a browser-style tab.
 * The tab renders the tunneled UI wholesale (an iframe), so the entry carries
 * exactly what the open gesture knew: the roster id it was opened from, the
 * device label the strip shows, and the loopback address the tunnel reported.
 */
export interface RemoteTab {
  /** Roster device id the tab was opened from; re-opening re-keys on it. */
  id: string
  /** Device label as the tab strip spells it. */
  label: string
  /** The tunneled UI address (a loopback http URL). */
  url: string
}

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 * The remoteTab pair is the window's tab strip: the open remote surfaces and
 * which one is on stage (`undefined` = the local Harness).
 */
type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  remoteTabs: RemoteTab[]
  activeRemote: string | undefined
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openRemoteTab: (draft: LayoutState, tab: RemoteTab) => void
  activateRemoteTab: (draft: LayoutState, id: string) => void
  showLocalTab: (draft: LayoutState) => void
  closeRemoteTab: (draft: LayoutState, id: string) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      remoteTabs: [],
      activeRemote: undefined,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      // Re-opening a device that already has a tab refreshes its address (the
      // tunnel may have come back on another port) and re-stages the tab.
      openRemoteTab: (d, tab: RemoteTab) => {
        const existing = d.remoteTabs.find(candidate => candidate.id === tab.id)
        if (existing === undefined) d.remoteTabs.push(tab)
        else {
          existing.label = tab.label
          existing.url = tab.url
        }
        d.activeRemote = tab.id
      },
      activateRemoteTab: (d, id: string) => {
        if (d.remoteTabs.some(tab => tab.id === id)) d.activeRemote = id
      },
      showLocalTab: (d) => { d.activeRemote = undefined },
      // Closing the staged tab hands the stage to the most recently opened
      // survivor, else back to the local Harness.
      closeRemoteTab: (d, id: string) => {
        const wasActive = d.activeRemote === id
        d.remoteTabs = d.remoteTabs.filter(tab => tab.id !== id)
        if (wasActive) d.activeRemote = d.remoteTabs.at(-1)?.id
      },
    },
  })
  return handle
}
