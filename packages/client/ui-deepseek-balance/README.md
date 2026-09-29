---
description: "The composer capsule for the official DeepSeek API balance: peak/valley-coded chip with a consumption popover, plus the sidebar toggle."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deepseek-balance

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-deepseek-balance` renders the official DeepSeek API account balance as a compact chip beside the model selector. The chip is color-coded for the current pricing period (peak/valley, Beijing time); clicking it opens a popover with daily and monthly consumption bar charts aggregated by the Host service. A sidebar footer toggle shows or hides the capsule and writes the stored `enabled` flag through the Host, so the entry's Settings form stays the one authority.

## Config

None. The capsule reads the `deepseekBalance` Remote namespace (`read`, `setEnabled`) provided by `@deepseek-ai/dsh-deepseek-balance`; its key reference, endpoint, and toggle default live in that Host entry's Settings form.

## Model Experience

None, as the capsule moves no session content and registers nothing model-facing.

#### KV Cache effect

None — balance reads run against the official billing endpoint through the Host and never alter model prompt payloads.

## Known Limitations and Deferred Work

- **One currency** — When the official API returns both CNY and USD, the capsule shows CNY.
- **Minute polling** — The source polls once per minute while mounted and on connection resets; the Host serves a five-second TTL cache.
