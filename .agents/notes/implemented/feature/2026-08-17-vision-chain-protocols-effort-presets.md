# Agent Note: Vision chain protocols, effort presets, and the input guard

Status: implemented

English | [中文](2026-08-17-vision-chain-protocols-effort-presets.zh.md)

## Problem

The vision chain spoke only OpenAI chat completions, and the settings card exposed only endpoint/key/model per backend. Three gaps pushed on the same seam: Anthropic and OpenAI Responses deployments could not be reached at all; effort vocabulary differs per vendor (OpenAI's five graded levels, Xiaomi MiMo's server treating low/medium/high identically, a local Qwen3's `chat_template_kwargs`, Anthropic's token-budget thinking), so no single raw control fits; and nothing stopped an oversized image from burning a remote call only to be refused by the server.

## Decision

**Per-backend `protocol`** (`openai-chat` default, `openai-responses`, `anthropic`) with one builder/parser pair per protocol inside the same chain provider — not one provider package per protocol. The chain's value is priority fallback across heterogeneous endpoints; splitting packages would force the seam's registry to re-learn ordering. Anthropic sends `x-api-key`, `authorization: Bearer`, and `anthropic-version: 2023-06-01` together (a compatible proxy may key off either auth header), mirroring the web search provider's Anthropic path.

**Vendor effort presets** (`effortPreset`) instead of a raw effort field. The config names whose vocabulary the model speaks; each protocol's fragment function maps it onto wire fields: `openai` → `reasoning_effort`/`reasoning.effort` at five levels; `mimo` → off is `none`, on is `low` (the three graded levels are server-equivalent, so the UI offers only the toggle); `qwen-local` → `chat_template_kwargs` with `enable_thinking` and `thinking_budget`; `anthropic` → `thinking.budget_tokens`. MiMo is deliberately a preset, not a protocol — there is no MiMo wire shape to find. Cross-field rules the schema cannot express (preset↔protocol pairing, anthropic's budget ≥1024 and below `maxTokens`) live in `validateVisionConfig`, wired into both the settings section's `validate` hook (save-time rejection, card keeps drafts) and `apply()` (load-time fail-loud), per *misconfiguration fails loud*.

**Reject, never clamp**: `contextTokens` over-requested by `maxTokens` fails validation rather than silently truncating the completion budget; `maxInputTokens` refuses a describe pre-flight with `VISION_INPUT_TOO_LARGE` and the chain falls to the next priority instead of recompressing the image. The estimate is documented heuristic — text at 4 chars/token plus probed pixels at 750/token (PNG/JPEG/GIF/WebP headers; unreadable headers fall back to byte count) — because the guard exists to catch grossly oversized inputs, not to bill.

Thinking/reasoning requests omit `temperature` on Responses and Anthropic-with-thinking because those APIs reject non-default sampling there; the chain's temperature stays on the chat-completions wire.

## Alternatives considered

**One provider package per protocol.** Three packages would each re-implement the chain's priority ordering and retry budget, and the seam registry would have to learn to sort providers — exactly the duplication the chain exists to remove. Protocol is a per-backend attribute of one chain, the same way `apiKeyEnv` is.

**A raw effort field instead of vendor presets.** No single vocabulary fits: OpenAI grades five levels, MiMo's server equates three of them, Qwen3 takes a boolean plus a token budget, Anthropic a budget with a 1024 floor. A raw field would push per-vendor mapping into every user's head and every UI hint; presets name the vocabulary once and let each protocol's fragment own the wire mapping.

**Clamping `maxTokens` to `contextTokens`, and recompressing oversized images.** Silent clamping makes a saved config lie about what the wire sends; rejection keeps the misconfiguration loud at the write. Recompression would silently change what the model sees — the guard refuses instead, and the chain's next priority, with its own limit, decides whether it can serve the input.

## Consequences

- Model-visible ⟺ logged is unaffected: every new parameter travels only on the sidecar HTTP request; the session log still records the `view_image` call and its result, never the sidecar wire.
- The settings card's per-row fields ride the same section; a row's probe carries its `protocol` so model discovery hits `/models` (OpenAI) or `/v1/models` (Anthropic, dual auth headers) correctly.
- The card controller keeps one `entries` array (row + key draft + numeric drafts + probe state) rather than parallel arrays moved in lockstep — the lockstep invariant had produced unreachable defensive branches and a probe-failure crash path.
- `VisionCard` passes no `onReset` (its list-editor fields can never stand as overrides); `FieldProps.onReset` is now optional precisely for that case.
- Closed-union `assertNever` defaults carry `v8 ignore` reasons instead of hostile-cast tests, matching the existing compaction packages.

Relates: [2026-08-16-vision-sidecar-seam](2026-08-16-vision-sidecar-seam.md).
