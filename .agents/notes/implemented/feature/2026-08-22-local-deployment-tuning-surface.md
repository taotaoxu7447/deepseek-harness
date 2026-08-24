# Agent Note: Local-deployment tuning surface — configurable stream idle timeout and per-model input modalities

Status: implemented

English | [中文](2026-08-22-local-deployment-tuning-surface.zh.md)

## Problem

Two settings-plane gaps bit local deployments specifically. First, the stream idle timeout was a hardcoded five minutes in both LLM adapters: a local engine serving a large MoE (or a cold speculative-decoding slot) can legitimately sit silent past that while prefilling, and the adapter aborted the request. Second, a provider's model rows had no way to declare vision support, so a local vision-capable model could never be sent an image — the DeepSeek adapter's catalog is local by design, and nothing in the UI could mark a hand-declared row as image-capable.

## Decision

The default stream idle timeout moves to ten minutes in both `llm-pi-ai` (`DEFAULT_STREAM_IDLE_TIMEOUT_MS = 600_000`) and `llm-deepseek`, and the provider editor's customized fold gains a **stream idle timeout** field beside `baseURL` for both families: seconds in the UI (the placeholder spells the inherited 600), milliseconds in the stored profile, blank inherits. The field follows the card's existing capacity-field pattern — a text buffer, validation that gates Apply, and a `set`/`unset` path op per edit — and both adapters' READMEs record the new default.

Per-model **input-modality capsules** sit in both model editors next to the reasoning-effort chips they mirror: `text` is the locked floor (always on, never stored alone), and clicking `image` declares vision support — stored as `input: ["text", "image"]` in a pi-ai model row and `inputModalities` in a DeepSeek row; switching image back off drops the key entirely so an undeclared row keeps inheriting. A shared `ModalityChips` component owns the parsing and toggle repair (an `["image"]`-only row heals back to the text floor), seated in `ModelListEditor` and `DeepSeekModelsEditor`.

## Alternatives considered

**An env var or cordis.yml-only knob for the timeout.** Rejected: the value varies per deployment and per route, which is exactly what the settings UI is for; a hidden knob would not have surfaced for the user who hit the abort.

**A provider-level modality toggle.** Rejected for the same reason reasoning effort stayed per-model (recorded in the Models page README): models under one provider disagree, and a provider-scoped flag would mis-declare every row that differs.

**A free-form modality list.** Rejected: the adapters model a closed set, and two capsules cover every current value without a validation vocabulary.

## Consequences

Local deployments stop dying at the five-minute silence mark without any configuration, and the ones that need more raise it per route without touching `settings.yaml`. The stored value is milliseconds while the UI speaks seconds — the parse/format pair owns that asymmetry. Modality declarations are additive and defaultless: existing configurations behave exactly as before until a row is explicitly marked vision-capable.

## Testing

The parse/format helpers, both editors' capsule behavior (toggle on, toggle off, key dropped, hidden fields preserved), and the provider-form field (seconds→milliseconds write, inherited placeholder, invalid gating) carry unit specs; both adapters' existing suites pin the new default.
