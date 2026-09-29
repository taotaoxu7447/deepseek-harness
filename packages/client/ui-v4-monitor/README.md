---
description: "The composer dock for the DeepSeek V4 Flash cluster: live slot states, decode rates, and the last task, fed by the ds-dash monitor through the Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-v4-monitor

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-v4-monitor` renders the DeepSeek V4 Flash live cluster state as a dock strip above the composer. Collapsed, it shows one compact line per slot with a context-usage meter and decode rate; expanded, it shows per-slot cards (context usage, prefill progress, decode tok/s) and the last completed task. The Host service probes the ds-dash monitor endpoint and paces the dock with its configured interval; a sidebar footer toggle shows or hides the dock and writes the stored `enabled` flag through the Host.

## Config

None. The dock reads the `v4Monitor` Remote namespace (`read`, `setEnabled`) provided by `@deepseek-ai/dsh-v4-monitor`; the monitor URL, invite passcode, poll interval, and collapse default live in that Host entry's Settings form.

## Model Experience

None, as the dock moves no session content and registers nothing model-facing.

#### KV Cache effect

None — monitoring reads run against the ds-dash telemetry endpoint through the Host and never alter model prompt payloads.

## Known Limitations and Deferred Work

- **On-demand polling** — The source polls only while mounted, paced by the Host's configured interval (default 2s) and re-read on connection resets.
- **Passcode security** — The invite passcode stays Host-side; only cluster state rides the response.
