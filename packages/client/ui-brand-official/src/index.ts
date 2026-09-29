/**
 * Official browser-brand plugin, node half. Registers the `brand-tag` settings
 * section on the host so client-side brand customization persists.
 */
import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Brand tag settings namespace identifier. */
export const BRAND_TAG_SETTINGS_NAMESPACE = settingsNamespace('brand-tag')

/** Durable brand tag settings configuration. */
export interface BrandTagConfig {
  text?: string
  strokeColor?: string
  fillColorLight?: string
  fillColorDark?: string
}

export const Config: z<BrandTagConfig> = z.object({
  text: z.string().default('TAO'),
  strokeColor: z.string().default('#00e5ff'),
  fillColorLight: z.string().default('#ffffff'),
  fillColorDark: z.string().default('#0f172a'),
})

/**
 * Host plugin entry: install the brand-tag settings section.
 * @param ctx - Host context.
 * @param entry - Initial configuration entry.
 */
export function apply(ctx: Context = new Context(), entry: BrandTagConfig = {}): void {
  installSettingsSection(ctx, BRAND_TAG_SETTINGS_NAMESPACE, Config, entry, {
    setSource: () => {},
    onChange: () => {},
  })
}
