/** `remoteEntry` namespace dictionaries: the sidebar trigger and the remote-device modal. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.label': '远程连接',
  'trigger.title': '连接到其他机器上的 DeepSeek Harness',
  'modal.title': '远程连接',
  'modal.description': '通过 SSH 隧道连接其他机器上的 dsh，已连接的设备可以直接在这里打开它的完整界面。',
  'modal.close': '关闭',
  'list.empty': '还没有设备。在下方添加一台已在本机 ssh 配置里的机器。',
  'state.unknown': '检查中…',
  'state.disconnected': '未连接',
  'state.connecting': '连接中…',
  'state.ready': '已连接',
  'state.failed': '连接失败',
  'action.connect': '连接',
  'action.disconnect': '断开',
  'action.openTab': '本窗口打开',
  'action.openTab.title': '在本窗口新增一个标签页显示远程界面',
  'action.openWindow': '新窗口打开',
  'action.openWindow.title': '在独立的应用窗口中打开远程界面',
  'add.toggle': '添加设备',
  'add.label': '显示名称',
  'add.label.placeholder': '例如：家里的 Mac Mini',
  'add.sshTarget': 'SSH 目标',
  'add.sshTarget.placeholder': '~/.ssh/config 里的 Host 别名',
  'add.remotePort': '远程端口',
  'add.remotePort.placeholder': '3080',
  'add.localPort': '本地端口',
  'add.localPort.placeholder': '留空自动分配',
  'add.autoConnect': '出现时自动连接',
  'add.submit': '保存设备',
  'add.cancel': '取消',
  'add.failed': '保存失败，请重试',
  'add.targetRequired': '请填写 SSH 目标',
} satisfies Record<string, string>

/** The remoteEntry namespace key union. */
export type RemoteEntryKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger.label': 'Remote',
  'trigger.title': 'Connect to a DeepSeek Harness on another machine',
  'modal.title': 'Remote connections',
  'modal.description': 'Reach dsh hosts on other machines through SSH tunnels; a connected device opens its full interface from here.',
  'modal.close': 'Close',
  'list.empty': 'No devices yet. Add one below from an alias already in your ssh config.',
  'state.unknown': 'Checking…',
  'state.disconnected': 'Disconnected',
  'state.connecting': 'Connecting…',
  'state.ready': 'Connected',
  'state.failed': 'Connection failed',
  'action.connect': 'Connect',
  'action.disconnect': 'Disconnect',
  'action.openTab': 'Open in tab',
  'action.openTab.title': 'Stage the remote interface as a tab in this window',
  'action.openWindow': 'Open in new window',
  'action.openWindow.title': 'Open the remote interface in its own app window',
  'add.toggle': 'Add device',
  'add.label': 'Display name',
  'add.label.placeholder': 'e.g. Home Mac Mini',
  'add.sshTarget': 'SSH target',
  'add.sshTarget.placeholder': 'Host alias from ~/.ssh/config',
  'add.remotePort': 'Remote port',
  'add.remotePort.placeholder': '3080',
  'add.localPort': 'Local port',
  'add.localPort.placeholder': 'Blank assigns one automatically',
  'add.autoConnect': 'Connect automatically when listed',
  'add.submit': 'Save device',
  'add.cancel': 'Cancel',
  'add.failed': 'Saving failed, please retry',
  'add.targetRequired': 'An SSH target is required',
} satisfies Record<RemoteEntryKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'remoteEntry'
