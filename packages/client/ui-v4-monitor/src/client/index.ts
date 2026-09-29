/**
 * DeepSeek V4 Flash live cluster monitor: composer dock + sidebar toggle.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { V4MonitorDock } from './V4MonitorDock.tsx'
import { V4MonitorToggle } from './V4MonitorToggle.tsx'
import { LOCAL_V4_NS, V4MonitorController } from './v4-monitor-controller.ts'
import { en, zh, NS } from './locales.ts'

export { V4MonitorDock } from './V4MonitorDock.tsx'
export type { V4MonitorDockProps } from './V4MonitorDock.tsx'
export { V4MonitorToggle } from './V4MonitorToggle.tsx'
export type { V4MonitorToggleProps } from './V4MonitorToggle.tsx'
export {
  LOCAL_V4_NS, V4MonitorController,
} from './v4-monitor-controller.ts'
export type {
  LocalV4Settings, V4MonitorDockFace, V4MonitorDockState, V4MonitorToggleFace,
} from './v4-monitor-controller.ts'
export { en, zh, NS } from './locales.ts'
export type { V4MonitorLocaleKey } from './locales.ts'

export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Mount the V4 monitor dock and the sidebar toggle that shows or hides it.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-v4-monitor: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new V4MonitorController(
    ctx.settingsScope.bind({ namespace: LOCAL_V4_NS }),
    connection.api,
  )

  ctx.effect(
    () => () => { controller.dispose() },
    'ui-v4-monitor: controller',
  )

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'v4-monitor',
    order: 5,
    locale: NS,
    inject: () => controller.injectDock(),
  }, V4MonitorDock))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'v4-monitor-toggle',
    order: 5,
    locale: NS,
    inject: () => controller.injectToggle(),
  }, V4MonitorToggle))
}
