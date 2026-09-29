# @deepseek-ai/dsh-client-ui-v4-monitor

English | [中文](README.zh.md)

DeepSeek V4 Flash live cluster monitoring dock above the composer, plus a sidebar footer toggle beside Remote. The strip is not bound to any session model: the sidebar button shows or hides it at any time.

The collapsed dock follows the [Composer status strip reference](../../../docs/composer-status-strips.md): its visible card is 38px high, stack spacing belongs to the conversation owner, and lower-priority telemetry disappears before the row can wrap. Expanding the same card reveals the bounded per-slot details.

## Slot Occupancy

- `conversation.input.dock` at `order: 5`
- `sidebar.footer.action` at `order: 5` (`v4-monitor-toggle`)

## Model Experience

None, as this package renders live cluster state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Connection settings** — The Host does not fetch until both a monitor address and an invite code are stored in the `local-v4` settings section.
- **Client polling** — While shown, state updates via the Host RPC bridge at the configured polling interval (default 2s).
