/**
 * Brand tag customization settings row: interactive editor for the sidebar's
 * and hero's top-left brand tag text and stroke color.
 */

import { useState, useSyncExternalStore, type ChangeEvent } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BrandWordmark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BrandTagSettings } from './Brand.tsx'
import css from './BrandTagRow.module.css'
/** Shipped color chip presets for the brand tag badge. */
export const COLOR_PRESETS = [
  '#00e5ff',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
] as const

/** Shipped brand tag defaults. */
export const DEFAULT_BRAND_TAG_SETTINGS: Required<BrandTagSettings> = {
  text: 'TAO',
  strokeColor: '#00e5ff',
  fillColorLight: '#ffffff',
  fillColorDark: '#0f172a',
}

/** Registration-side injected face carrying the brand tag settings scope. */
export interface BrandTagRowInjected {
  hooks: {
    brandTagSettings: SettingsScope<BrandTagSettings>
  }
  scope?: SettingsScope<BrandTagSettings>
}

/** Composed props for the brand tag settings row. */
export type BrandTagRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'brand'>
  & Partial<InjectFace<BrandTagRowInjected>>
  & {
    scope?: SettingsScope<BrandTagSettings>
  }

/**
 * Render the customizable brand tag preference row with live preview and color presets.
 * @param props - composed Settings slot props.
 * @returns the interactive preference row.
 */
export function BrandTagRow({
  useBrandTagSettings,
  scope,
  t,
}: BrandTagRowProps) {
  const fallbackSnapshot = useSyncExternalStore(
    onStoreChange => scope?.subscribe(onStoreChange) ?? (() => {}),
    () => scope?.getSnapshot().value,
    () => scope?.getSnapshot().value,
  )
  const hookSnapshot = useBrandTagSettings?.(s => s.value)
  const settings = useBrandTagSettings !== undefined ? hookSnapshot : fallbackSnapshot

  const [localText, setLocalText] = useState<string | null>(null)
  const [localStroke, setLocalStroke] = useState<string | null>(null)

  const currentText = localText !== null ? localText : (settings?.text ?? DEFAULT_BRAND_TAG_SETTINGS.text)
  const currentStroke = localStroke !== null ? localStroke : (settings?.strokeColor ?? DEFAULT_BRAND_TAG_SETTINGS.strokeColor)

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nextText = e.target.value.slice(0, 8)
    setLocalText(nextText)
    void scope?.set('text', nextText)
  }

  const handleColorPreset = (color: string) => {
    setLocalStroke(color)
    void scope?.set('strokeColor', color)
  }

  const handleHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setLocalStroke(val)
    void scope?.set('strokeColor', val)
  }

  const handleReset = () => {
    setLocalText(DEFAULT_BRAND_TAG_SETTINGS.text)
    setLocalStroke(DEFAULT_BRAND_TAG_SETTINGS.strokeColor)
    if (!scope) return
    void scope.set('text', DEFAULT_BRAND_TAG_SETTINGS.text)
    void scope.set('strokeColor', DEFAULT_BRAND_TAG_SETTINGS.strokeColor)
    void scope.set('fillColorLight', DEFAULT_BRAND_TAG_SETTINGS.fillColorLight)
    void scope.set('fillColorDark', DEFAULT_BRAND_TAG_SETTINGS.fillColorDark)
  }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('brandTag.title')}</div>
        <div className={css.desc}>{t('brandTag.description')}</div>
        <div className={css.preview}>
          <BrandWordmark
            includeMark={false}
            tagText={currentText}
            tagStroke={currentStroke}
            tagFillLight={settings?.fillColorLight}
            tagFillDark={settings?.fillColorDark}
          />
        </div>
      </div>
      <div className={css.controls}>
        <div className={css.fieldGroup}>
          <input
            type="text"
            className={css.input}
            maxLength={8}
            value={currentText}
            placeholder={t('brandTag.textPlaceholder')}
            onChange={handleTextChange}
            aria-label={t('brandTag.title')}
          />
        </div>
        <div className={css.colorRow}>
          <div className={css.presets} role="radiogroup" aria-label="Color presets">
            {COLOR_PRESETS.map((color) => {
              const active = currentStroke.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={color}
                  type="button"
                  className={active ? `${css.colorChip} ${css.colorChipActive}` : css.colorChip}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                  aria-checked={active}
                  role="radio"
                  onClick={() => handleColorPreset(color)}
                />
              )
            })}
          </div>
          <input
            type="text"
            className={css.hexInput}
            value={currentStroke}
            placeholder="#00e5ff"
            maxLength={7}
            onChange={handleHexChange}
            aria-label="HEX"
          />
        </div>
        <button
          type="button"
          className={css.resetButton}
          onClick={handleReset}
        >
          {t('brandTag.reset')}
        </button>
      </div>
    </div>
  )
}
