# @deepseek-ai/dsh-deepseek-balance

English | [中文](README.zh.md)

Official DeepSeek API account-balance proxy, exposed as `ctx.deepseekBalance`. The Host resolves the key from this entry's own credential fields (`DEEPSEEK_API_KEY` by default) and queries `GET https://api.deepseek.com/user/balance`. The key never leaves the Host.

Every field is volatile, so the entry is its live Settings form: edits apply without a reload.

## Config

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Whether the composer balance capsule is shown. The sidebar toggle writes this. |
| `apiKey` | — | Literal official API key; prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference resolved for each fetch. |
| `baseURL` | `https://api.deepseek.com` | Official API base; `/user/balance` is appended. |

```yaml
- id: deepseek-balance
  name: '@deepseek-ai/dsh-deepseek-balance'
```

## Model Experience

None, as the balance service moves no session content and registers nothing model-facing.

#### KV Cache effect

None — balance requests query the official billing endpoint independently and never alter model prompt payloads.

## Known Limitations and Deferred Work

- **Key not shared with `llm-deepseek`** — 0.2.0 has no cross-entry settings read, so an installation whose conversation key is set as a literal in the `llm-deepseek` entry repeats it here (or switches that entry to `apiKeyEnv`).
- **One currency** — When the official API returns both CNY and USD, the capsule shows CNY.
- **No 0.2.0 capsule UI yet** — the browser capsule dock needs a port onto the current client-plugin surface; until then the service serves host-side consumers only.
