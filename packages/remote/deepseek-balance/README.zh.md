# @deepseek-ai/dsh-deepseek-balance

[English](README.md) | 中文

官方 DeepSeek API 账户余额代理，暴露为 `ctx.deepseekBalance`。Host 从本条目自己的凭据字段（默认 `DEEPSEEK_API_KEY`）解析密钥，并查询 `GET https://api.deepseek.com/user/balance`。密钥不会离开 Host。

所有字段均为 volatile，条目本身就是实时设置表单：改动即时生效，无需重载。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 是否显示输入栏余额胶囊。侧栏开关写入此项。 |
| `apiKey` | — | 字面量官方 API 密钥；优先使用 `apiKeyEnv`，避免密钥进入配置文件。 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次请求解析的凭据引用。 |
| `baseURL` | `https://api.deepseek.com` | 官方 API 基址；自动追加 `/user/balance`。 |

```yaml
- id: deepseek-balance
  name: '@deepseek-ai/dsh-deepseek-balance'
```

## 模型体验

无。余额服务不移动任何会话内容，也不注册模型可见的内容。

#### KV Cache 效应

无 — 余额请求独立查询官方计费接口，从不改动模型提示词。

## 已知限制与后续工作

- **密钥不与 `llm-deepseek` 共享** — 0.2.0 没有跨条目设置读取，会话密钥若以字面量配置在 `llm-deepseek` 条目中，需要在这里重复一次（或把该条目改为 `apiKeyEnv`）。
- **单一币种** — 官方 API 同时返回 CNY 与 USD 时，胶囊显示 CNY。
- **胶囊 UI** — 浏览器端胶囊在 `@deepseek-ai/dsh-client-ui-deepseek-balance`（输入栏芯片 + 消费弹层 + 侧栏开关），走本服务的 `deepseekBalance` Remote 命名空间。
