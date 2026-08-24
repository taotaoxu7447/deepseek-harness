/**
 * Official DeepSeek API balance: composer capsule + sidebar toggle.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BalanceCapsule } from './BalanceCapsule.tsx'
import { BalanceToggle } from './BalanceToggle.tsx'
import { BALANCE_NS, BalanceController } from './balance-controller.ts'
import { en, zh, NS } from './locales.ts'

export { BalanceCapsule } from './BalanceCapsule.tsx'
export type { BalanceCapsuleProps } from './BalanceCapsule.tsx'
export { BalanceToggle } from './BalanceToggle.tsx'
export type { BalanceToggleProps } from './BalanceToggle.tsx'
export { ConsumptionPopover, formatCurrency } from './ConsumptionPopover.tsx'
export type { ConsumptionPopoverProps } from './ConsumptionPopover.tsx'
export {
  BALANCE_NS, BalanceController, DEFAULT_POLL_INTERVAL_MS, formatBalance,
} from './balance-controller.ts'
export type {
  BalanceCapsuleFace, BalanceSettings, BalanceState, BalanceToggleFace,
} from './balance-controller.ts'
export { en, zh, NS } from './locales.ts'
export type { DeepSeekBalanceLocaleKey } from './locales.ts'

export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Mount the official-API balance capsule and the sidebar toggle that shows or hides it.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deepseek-balance: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new BalanceController(
    ctx.settingsScope.bind({ namespace: BALANCE_NS }),
    connection.api,
  )

  ctx.effect(
    () => () => { controller.dispose() },
    'ui-deepseek-balance: controller',
  )

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'deepseek-balance',
    order: 100,
    locale: NS,
    inject: () => controller.injectCapsule(),
  }, BalanceCapsule))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'deepseek-balance-toggle',
    order: 15,
    locale: NS,
    inject: () => controller.injectToggle(),
  }, BalanceToggle))
}
