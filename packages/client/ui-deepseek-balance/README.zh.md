# @deepseek-ai/dsh-client-ui-deepseek-balance

[English](README.md) | 中文

官方 DeepSeek API 余额胶囊，紧挨在输入栏模型选择器左侧，另加侧栏底部开关。Host 解析已经配置好的官方密钥；本包看不到密钥。

## Slot 占用

- `conversation.input.right`，`order: 100`（`deepseek-balance`）
- `sidebar.footer.action`，`order: 15`（`deepseek-balance-toggle`）

## 模型体验

无。本包只向人展示一个计费数字，不触及提示词、消息、schema、流或工具结果。

#### KV Cache 效应

无；本包从不组装或发送提供方请求。

## 已知限制与后续工作

- **仅官方密钥** — 胶囊读取官方 DeepSeek API 余额，不是 PLN 或自定义网关账户。
- **客户端轮询** — 显示期间通过 Host RPC 每 60 秒刷新一次。
