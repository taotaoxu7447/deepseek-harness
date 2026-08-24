# @deepseek-ai/dsh-client-ui-deepseek-balance

English | [中文](README.zh.md)

Official DeepSeek API balance capsule immediately left of the composer model picker, plus a sidebar footer toggle. The Host resolves the already-configured official key; this package never sees it.

## Slot Occupancy

- `conversation.input.right` at `order: 100` (`deepseek-balance`)
- `sidebar.footer.action` at `order: 15` (`deepseek-balance-toggle`)

## Model Experience

None, as this package renders a billing number for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Official key only** — The capsule reads the official DeepSeek API balance, not a PLN or custom gateway account.
- **Client polling** — While shown, the capsule refreshes through the Host RPC bridge every 60s.
