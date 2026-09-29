/** Local V4 Flash monitor dock locale dictionary. */

/** Dictionary namespace identifier. */
export const NS = 'v4Monitor'

/** Locale keys and values required by the V4 monitor dock. */
export interface V4MonitorLocaleMap {
  v4DockTitle: string
  v4LocalTag: string
  v4Slot: string
  v4Idle: string
  v4Prefilling: string
  v4Decoding: string
  v4CtxUsage: string
  v4Speculative: string
  v4LastTask: string
  v4StaleWarning: string
  v4PollingStatus: string
  v4Disconnected: string
  v4Expand: string
  v4Collapse: string
  v4CompactDecoding: string
  v4CompactPrefilling: string
  v4CompactIdle: string
  v4ToggleLabel: string
  v4ToggleTitle: string
}

/** Valid dictionary keys for the V4 monitor dock. */
export type V4MonitorLocaleKey = keyof V4MonitorLocaleMap

/** English copy dictionary. */
export const en: Record<V4MonitorLocaleKey, string> = {
  v4DockTitle: 'DeepSeek V4 Flash',
  v4LocalTag: 'Local Compute',
  v4Slot: 'Slot {id}',
  v4Idle: 'Idle',
  v4Prefilling: 'Prefilling {progress}% ({tps} tok/s)',
  v4Decoding: 'Decoding {tps} tok/s',
  v4CtxUsage: 'Context: {used} / {total} ({percent}%)',
  v4Speculative: 'Speculative: Enabled (DSpark)',
  v4LastTask: 'Last Task: #{task} · {tokens} tokens @ {tps} tok/s ({duration}s)',
  v4StaleWarning: 'Data Stale',
  v4PollingStatus: '{interval}s polling',
  v4Disconnected: 'Not connected',
  v4Expand: 'Expand details',
  v4Collapse: 'Collapse',
  v4CompactDecoding: '{tps} tok/s',
  v4CompactPrefilling: '{progress}%',
  v4CompactIdle: 'idle',
  v4ToggleLabel: 'Cluster monitor',
  v4ToggleTitle: 'Show or hide the cluster monitor above the composer',
}

/** Simplified Chinese copy dictionary. */
export const zh: Record<V4MonitorLocaleKey, string> = {
  v4DockTitle: 'DeepSeek-V4-Flash',
  v4LocalTag: '本地算力',
  v4Slot: 'Slot {id}',
  v4Idle: '空闲待命',
  v4Prefilling: '预填中 {progress}% ({tps} tok/s)',
  v4Decoding: '生成中 {tps} tok/s',
  v4CtxUsage: '上下文: {used} / {total} ({percent}%)',
  v4Speculative: '投机解码: 启用 (DSpark)',
  v4LastTask: '最近任务: #{task} · {tokens} tok @ {tps} tok/s (耗时 {duration}s)',
  v4StaleWarning: '监控数据已过期',
  v4PollingStatus: '{interval}s 轮询',
  v4Disconnected: '未连接',
  v4Expand: '展开详情',
  v4Collapse: '收起',
  v4CompactDecoding: '{tps} tok/s',
  v4CompactPrefilling: '{progress}%',
  v4CompactIdle: '空闲',
  v4ToggleLabel: '集群监控',
  v4ToggleTitle: '打开或关闭输入框上方的集群监控条',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    v4Monitor: V4MonitorLocaleKey
  }
}
