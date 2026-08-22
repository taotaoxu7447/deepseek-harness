# @deepseek-ai/dsh-deepseek-balance

English | [中文](README.zh.md)

Official DeepSeek API account-balance proxy, exposed as `ctx.deepseekBalance`. The Host resolves the already-configured official key (`DEEPSEEK_API_KEY`, or `llm-deepseek.apiKeyEnv`) and queries `GET https://api.deepseek.com/user/balance`. The key never leaves the Host.

The Web capsule is shown from a sidebar footer toggle. This package stores only that `enabled` flag.

## Config

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Whether the composer balance capsule is shown. The sidebar toggle writes this. |

```yaml
- id: deepseek-balance
  name: '@deepseek-ai/dsh-deepseek-balance'
```

## Model Experience

None, as the balance service moves no session content and registers nothing model-facing.

#### KV Cache effect

None — balance requests query the official billing endpoint independently and never alter model prompt payloads.

## Known Limitations and Deferred Work

- **Official endpoint only** — Balance is always read from `api.deepseek.com`, not from a custom `llm-deepseek.baseURL` gateway.
- **One currency** — When the official API returns both CNY and USD, the capsule shows CNY.
