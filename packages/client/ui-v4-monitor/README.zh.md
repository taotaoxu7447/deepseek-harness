# @deepseek-ai/dsh-client-ui-v4-monitor

[English](README.md) | 中文

DeepSeek V4 Flash 集群监控状态条挂在输入框上方；侧栏底部（远程连接旁边）有开关。不绑定任何会话模型，随时可开可关。

收起状态遵循 [Composer 状态条参考](../../../docs/composer-status-strips.zh.md)：可见卡片高 38px，条目间距由 conversation 所有方提供，低优先级遥测会在该行可能换行之前先隐藏。展开同一张卡片后显示有高度上限的逐 Slot 详情。

## 插槽占用

- `conversation.input.dock`，`order: 5`
- `sidebar.footer.action`，`order: 5`（`v4-monitor-toggle`）

## 模型体验

无。本包只向人展示集群状态，不触碰提示词、消息、schema、流或工具结果。

#### KV Cache 效应

无。本包从不组装或发送提供方请求。

## 已知限制与后续工作

- **连接参数** — 未在 `local-v4` 设置段同时写入监控地址与邀请码时，Host 不会请求监控。
- **客户端轮询** — 打开时通过 Host RPC 按配置周期刷新（默认 2 秒）。
