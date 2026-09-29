/**
 * DeepSeek V4 Flash cluster monitor surface, browser half: the composer dock
 * entry in `conversation.input.dock` and the sidebar footer toggle. The dock
 * reads the `v4Monitor` Remote namespace through a registrant-private polling
 * source paced by the Host's configured interval; the toggle writes the
 * entry's stored user section through the Host so the Settings form stays the
 * one authority.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { V4MonitorDock } from './V4MonitorDock.tsx'
import { V4MonitorToggle } from './V4MonitorToggle.tsx'
import { createV4MonitorController } from './v4-monitor-controller.ts'
import { en, zh, NS } from './locales.ts'

export { V4MonitorDock } from './V4MonitorDock.tsx'
export type { V4MonitorDockProps } from './V4MonitorDock.tsx'
export { V4MonitorToggle } from './V4MonitorToggle.tsx'
export type { V4MonitorToggleProps } from './V4MonitorToggle.tsx'
export {
  DEFAULT_POLL_INTERVAL_MS, createV4MonitorController,
} from './v4-monitor-controller.ts'
export type {
  V4MonitorControllerDeps, V4MonitorDockFace, V4MonitorDockState, V4MonitorToggleFace,
} from './v4-monitor-controller.ts'
export { en, zh, NS } from './locales.ts'
export type { V4MonitorLocaleKey } from './locales.ts'

/** Required services: slot registry, locale dictionaries, and the generated Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.v4Monitor']

/**
 * Mount the V4 monitor dock and the sidebar toggle that shows or hides it.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-v4-monitor: dictionaries')

  const controller = createV4MonitorController({
    read: force => ctx.remote.v4Monitor.read(force),
    setEnabled: enabled => ctx.remote.v4Monitor.setEnabled(enabled),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'v4-monitor',
    order: 5,
    locale: NS,
    inject: () => ({
      hooks: { v4Dock: controller.source },
      toggleCollapse: () => { controller.toggleCollapse() },
      refresh: () => controller.refresh(),
    }),
  }, V4MonitorDock))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'v4-monitor-toggle',
    order: 5,
    locale: NS,
    inject: () => ({
      hooks: { v4Dock: controller.source },
      toggleEnabled: () => { controller.toggleEnabled() },
    }),
  }, V4MonitorToggle))
}
