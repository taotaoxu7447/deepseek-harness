/**
 * Remote-device main-surface entry, browser half: registers the `remoteEntry`
 * dictionaries and contributes the sidebar footer action whose modal lists
 * the `remote` RPC domain's roster, drives its connect/disconnect verbs, and
 * stages a ready tunnel two ways — a window tab through ctx.layout, or a new
 * browsing context (an app window under the macOS shell). The same roster
 * lives in Settings → Plugins for staged editing; this surface is the
 * connect-and-open path.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.layout into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the 'sidebar.footer.action' SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.settingsScope Context merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { RemoteEntry } from './RemoteEntry.tsx'
import { REMOTE_NS, RemoteEntryController } from './remote-entry-controller.ts'
import { en, zh, NS, type RemoteEntryKey } from './locales.ts'

export { RemoteEntry } from './RemoteEntry.tsx'
export type { RemoteEntryProps } from './RemoteEntry.tsx'
export {
  deviceLabel, mintDeviceId,
  REMOTE_ENTRY_POLL_MS, REMOTE_LABEL_PARAM, REMOTE_NS, RemoteEntryController,
} from './remote-entry-controller.ts'
export type {
  AddDeviceDraft, RemoteEntryDevice, RemoteEntryFace, RemoteEntryNavigation,
  RemoteEntryState, RemoteSettings, RemoteTunnelPhase,
} from './remote-entry-controller.ts'
export { en, zh, NS } from './locales.ts'
export type { RemoteEntryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar trigger + remote-device modal copy. */
    remoteEntry: RemoteEntryKey
  }
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-sidebar's apply, whose activation order relative to this one is NOT
 * constrained; the registration depends on its slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'layout']

/**
 * Register the `remoteEntry` dictionaries and the sidebar footer action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new RemoteEntryController(
    ctx.settingsScope.bind({ namespace: REMOTE_NS }),
    connection.api,
    ctx.layout,
  )
  ctx.effect(
    () => () => { controller.dispose() },
    'ui-remote: remote entry controller',
  )

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'remote-entry',
    order: 0,
    locale: NS,
    inject: () => controller.inject(),
  }, RemoteEntry))
}
