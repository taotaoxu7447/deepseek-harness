# @deepseek-ai/dsh-client-ui-v4-monitor

[English](README.md) | 中文

DeepSeek V4 Flash 集群监控状态条挂在输入框上方；侧栏底部（远程连接旁边）有开关。不绑定任何会话模型，随时可开可关。

## 插槽占用

- `conversation.input.dock`，`order: 5`
- `sidebar.footer.action`，`order: 5`（`v4-monitor-toggle`）

## 模型体验

无。本包只向人展示集群状态，不触碰提示词、消息、schema、流或工具结果。

#### KV Cache 效应

无。本包从不组装或发送提供方请求。

## 已知限制与后续工作

- **邀请码** — 未在 `local-v4` 设置段写入邀请码时，Host 不会请求监控。
- **客户端轮询** — 打开时通过 Host RPC 按配置周期刷新（默认 2 秒）。
