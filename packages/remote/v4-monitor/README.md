# @deepseek-ai/dsh-v4-monitor

English | [中文](README.zh.md)

DeepSeek V4 Flash live cluster monitoring service and ds-dash state proxy, exposed as the `ctx.v4Monitor` service. The Web surface turns the composer strip on from the sidebar and edits connection details under **Settings → Plugins → Local compute monitor**.

Authentication rides the `X-Dash-Pass` header. The Host proxy avoids browser CORS restrictions. Neither the monitor address nor the invite code has a composition default: the service does not fetch until both are stored.

## Config

The composition entry seeds the settings and the optional `local-v4` settings section overrides it live:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Whether the composer status dock is shown. The sidebar toggle writes this. |
| `monitorUrl` | _(empty)_ | The ds-dash monitor endpoint URL. |
| `passcode` | _(empty)_ | Invite code sent in the `X-Dash-Pass` header. |
| `pollIntervalMs` | `2000` | Polling interval in milliseconds when the dock is shown. |
| `autoCollapse` | `false` | Whether the status dock starts collapsed. |

```yaml
- id: v4-monitor
  name: '@deepseek-ai/dsh-v4-monitor'
```

## Model Experience

None, as the cluster monitoring service moves no session content and registers nothing model-facing.

#### KV Cache effect

None — monitoring requests query the ds-dash telemetry endpoint independently and never alter model prompt payloads.

## Known Limitations and Deferred Work

- **Polling on-demand** — State is queried via HTTP polling rather than SSE push streams; polling occurs only while the dock is shown and both connection settings are present.
- **Passcode security** — Invite codes are stored in the local settings document and passed as custom request headers.
