/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BRAND_TAG_NS, type BrandTagSettings, OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

export { BRAND_TAG_NS, OfficialBrandMark, OfficialBrandName }
export type { BrandTagSettings, OfficialBrandNameProps } from './Brand.tsx'

/** Required services: the UI slot registry and settings scope. */
export const inject = ['slots', 'settingsScope']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  const brandTagScope = ctx.settingsScope.bind<BrandTagSettings>({ namespace: BRAND_TAG_NS })

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
        yield ctx.slots.register({
          name: 'sidebar.brand.name',
          inject: () => ({
            hooks: { brandTagSettings: brandTagScope },
          }),
        }, OfficialBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark)
      })))
}
