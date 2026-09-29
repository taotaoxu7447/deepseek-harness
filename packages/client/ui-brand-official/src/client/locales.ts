/** `brand` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'brand'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brandTag.title': '个性化标牌',
  'brandTag.description': '自定义左上角品牌标牌文字与配色',
  'brandTag.textPlaceholder': '输入文字(最多8字)',
  'brandTag.reset': '恢复默认',
} satisfies Record<string, string>

/** The brand namespace key union. */
export type BrandLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<BrandLocaleKey, string> = {
  'brandTag.title': 'Custom Brand Tag',
  'brandTag.description': 'Customize top-left brand tag text and colors',
  'brandTag.textPlaceholder': 'Tag text (max 8 chars)',
  'brandTag.reset': 'Reset',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Brand official slot copy. */
    brand: BrandLocaleKey
  }
}
