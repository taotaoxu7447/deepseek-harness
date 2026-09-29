/**
 * Official DeepSeek API balance surface, browser half: the composer capsule
 * entry in `conversation.input.right` and the sidebar footer toggle. The
 * capsule reads the `deepseekBalance` Remote namespace through a
 * registrant-private polling source; the toggle writes the entry's stored
 * user section through the Host so the Settings form stays the one authority.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BalanceCapsule } from './BalanceCapsule.tsx'
import { BalanceToggle } from './BalanceToggle.tsx'
import { createBalanceController } from './balance-controller.ts'
import { en, zh, NS } from './locales.ts'

export { BalanceCapsule } from './BalanceCapsule.tsx'
export type { BalanceCapsuleProps } from './BalanceCapsule.tsx'
export { BalanceToggle } from './BalanceToggle.tsx'
export type { BalanceToggleProps } from './BalanceToggle.tsx'
export { ConsumptionPopover, formatCurrency } from './ConsumptionPopover.tsx'
export type { ConsumptionPopoverProps } from './ConsumptionPopover.tsx'
export {
  DEFAULT_POLL_INTERVAL_MS, createBalanceController, formatBalance,
} from './balance-controller.ts'
export type {
  BalanceCapsuleFace, BalanceControllerDeps, BalanceState, BalanceToggleFace,
} from './balance-controller.ts'
export { en, zh, NS } from './locales.ts'
export type { DeepSeekBalanceLocaleKey } from './locales.ts'

/** Required services: slot registry, locale dictionaries, and the generated Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.deepseekBalance']

/**
 * Mount the official-API balance capsule and the sidebar toggle that shows or hides it.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deepseek-balance: dictionaries')

  const controller = createBalanceController({
    read: force => ctx.remote.deepseekBalance.read(force),
    setEnabled: enabled => ctx.remote.deepseekBalance.setEnabled(enabled),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'deepseek-balance',
    order: 100,
    locale: NS,
    inject: () => ({
      hooks: { balance: controller.source },
    }),
  }, BalanceCapsule))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'deepseek-balance-toggle',
    order: 15,
    locale: NS,
    inject: () => ({
      hooks: { balance: controller.source },
      toggleEnabled: () => { controller.toggleEnabled() },
    }),
  }, BalanceToggle))
}
