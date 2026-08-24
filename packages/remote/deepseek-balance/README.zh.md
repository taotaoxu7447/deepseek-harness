# @deepseek-ai/dsh-deepseek-balance

[English](README.md) | 中文

官方 DeepSeek API 账户余额代理，暴露为 `ctx.deepseekBalance`。Host 解析已经配置好的官方密钥（`DEEPSEEK_API_KEY`，或 `llm-deepseek.apiKeyEnv`），并查询 `GET https://api.deepseek.com/user/balance`。密钥不会离开 Host。

Web 胶囊由侧栏底部开关控制。本包只保存这个 `enabled` 标志。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 是否显示输入栏余额胶囊。侧栏开关写入此项。 |

```yaml
- id: deepseek-balance
  name: '@deepseek-ai/dsh-deepseek-balance'
```

## 模型体验

无。余额服务不移动任何会话内容，也不注册模型可见的内容。

#### KV Cache 效应

无 — 余额请求独立查询官方计费接口，从不改动模型提示词。

## 已知限制与后续工作

- **仅官方端点** — 余额始终从 `api.deepseek.com` 读取，不会走自定义 `llm-deepseek.baseURL` 网关。
- **单一币种** — 官方 API 同时返回 CNY 与 USD 时，胶囊显示 CNY。
