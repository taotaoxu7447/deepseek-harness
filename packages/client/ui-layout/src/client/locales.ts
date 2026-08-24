/** `layout` namespace dictionaries: the window tab strip's chrome copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tabs.local': '本机',
  'tabs.local.label': '本机 DeepSeek Harness',
  'tabs.close': '关闭标签页',
  'tabs.strip.label': '本机与远程连接标签页',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'tabs.local': 'Local',
  'tabs.local.label': 'Local DeepSeek Harness',
  'tabs.close': 'Close tab',
  'tabs.strip.label': 'Local and remote tabs',
} satisfies Record<LayoutKey, string>
