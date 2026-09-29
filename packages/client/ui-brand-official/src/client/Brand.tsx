import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

/** Brand tag settings namespace. */
export const BRAND_TAG_NS = 'brand-tag'

/** Durable settings schema for the brand tag badge. */
export interface BrandTagSettings {
  text?: string
  strokeColor?: string
  fillColorLight?: string
  fillColorDark?: string
}

/** Injected face carrying the reactive brand tag settings scope. */
export interface BrandNameInjected {
  hooks: {
    brandTagSettings: SettingsScope<BrandTagSettings>
  }
}

/** Composed props for the official brand name component. */
export type OfficialBrandNameProps = Partial<InjectFace<BrandNameInjected>>

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @param props - Injected slot face containing the brand tag settings hook.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ useBrandTagSettings }: OfficialBrandNameProps = {}) {
  const settings = useBrandTagSettings?.(s => s.value)
  return (
    <BrandWordmark
      includeMark={false}
      tagText={settings?.text}
      tagStroke={settings?.strokeColor}
      tagFillLight={settings?.fillColorLight}
      tagFillDark={settings?.fillColorDark}
    />
  )
}
