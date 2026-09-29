# @deepseek-ai/dsh-vision-qwen

English | [中文](README.zh.md)

The multi-protocol `VisionProvider` chain for the harness [vision capability seam](../vision/README.md) (`ctx.vision`): one provider whose `backends` list is the priority order — the first usable entry serves, and a backend that exhausts its attempt budget falls to the next. Each backend speaks one of three wire protocols — OpenAI chat completions (a local vLLM/SGLang Qwen deployment, or any compatible server), OpenAI Responses, or Anthropic Messages. The image rides the request as a base64 payload; the reply text becomes the description.

This is an **implementation** package: it registers a provider into `ctx.vision`, it does not own the `ctx.vision` key, and it does not register a model-facing tool (that is [`dsh-tool-vision`](../tool-vision/README.md)). It is a function/namespace plugin (`inject: ['vision']`), not a default-export service.

Connection facts resolve per call, layered: the `cordis.yml` entry config under the optional `vision` user-settings section (`ctx.settings`) — the web **Settings → Plugins → Vision** card edits it — with each backend's API key resolved through the credential seam. A changed chain, priority, model, protocol, effort choice, or key reaches the very next describe without a restart. A section with no usable backend (no `model`, or an unparseable `baseURL`) parks the provider — registered, but refusing selection — instead of failing the load: the settings card is the intended place to finish configuring it.

## Config

Chain-wide keys:

| Key | Default | Meaning |
|---|---|---|
| `backends` | `[]` | The priority chain (index 0 served first); at most 5 entries. |
| `attemptsPerBackend` | `2` | Attempts each backend gets before the chain falls to the next priority. |
| `temperature` | `0.2` | Sampling temperature, within `[0, 2]`. Sent on chat completions and on Anthropic Messages without thinking; Responses and thinking requests reject a non-default one, so it is omitted there. |
| `maxTokens` | `1024` | Completion budget (tokens) for one description. A backend's `contextTokens`, when set, must be at least this — a violation is rejected at save/load, never clamped. |
| `timeoutMs` | `60000` | HTTP budget for one attempt; firing maps to `VISION_ABORTED`. |

Per-backend keys (each `backends` entry):

| Key | Default | Meaning |
|---|---|---|
| `id` | (required) | Stable id naming the backend in errors and credential references. |
| `enabled` | `true` | False parks this backend without reordering the rest. |
| `baseURL` | `$QWEN_BASE_URL` | Endpoint base; the protocol's path is appended (`/chat/completions`, `/responses`, or `/v1/messages`). |
| `model` | (unset) | Vision model id the endpoint serves. Unset makes the backend unusable. |
| `apiKeyEnv` | `VISION_<ID>_API_KEY` | Credential reference resolved for each describe. An empty answer sends no auth header — a keyless local endpoint works without any key. |
| `apiKey` | (unset) | Literal API key; prefer `apiKeyEnv` so no secret enters configuration files. |
| `instruction` | built-in | System instruction for this backend's describe calls. |
| `protocol` | `openai-chat` | Wire protocol: `openai-chat`, `openai-responses`, or `anthropic`. |
| `effortPreset` | (unset) | Whose effort vocabulary the model speaks: `openai`, `mimo`, `qwen-local`, or `anthropic`. Unset sends no effort parameter. |
| `effortLevel` | (unset) | Graded level for the `openai` preset: `none`/`minimal`/`low`/`medium`/`high`. |
| `effortEnabled` | (unset) | Effort toggle for the `mimo`, `qwen-local`, and `anthropic` presets. |
| `thinkingBudget` | (unset) | Thinking budget (tokens) for `qwen-local` (`thinking_budget`) and `anthropic` (`budget_tokens`; with the toggle on, at least 1024 and below `maxTokens`). |
| `contextTokens` | (unset) | Advertised context window; the write is rejected when `maxTokens` exceeds it. |
| `maxInputTokens` | (unset) | Estimated-input guard; a describe whose estimate exceeds it is refused with `VISION_INPUT_TOO_LARGE` before any request, and the chain falls to the next priority. |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

No config is required at composition: finish setup on the Plugins settings card (add a backend, pick its protocol, endpoint, key, model — the probe button fills the model id from the endpoint's own listing) and the values persist in the user settings document with hot effect. The card draws the chain top-down as priority order — drag a row's ⋮⋮ handle (or use its up/down buttons) to re-sequence, and the connector between rows names the fallback after the staged attempts. The footer also edits the chain's output limit (`maxTokens`, blank inherits the built-in 1024); a backend's `maxInputTokens` guard stays YAML-only. Each row collapses to its head (its ▾ button, or Collapse all for the chain) so a long chain stays draggable. A typed API key echoes as password dots with a staged badge until the save lands; after it, the field clears and the configured badge carries the state — the stored key is never read back. A composed chain looks like:

```yaml
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
  config:
    backends:
      - id: local-qwen
        baseURL: http://localhost:8000/v1
        model: qwen3-vl-27b
        effortPreset: qwen-local
        effortEnabled: true
        thinkingBudget: 2048
      - id: claude-fallback
        baseURL: https://api.anthropic.com
        model: claude-sonnet-4-5
        protocol: anthropic
        effortPreset: anthropic
        apiKeyEnv: ANTHROPIC_API_KEY
    attemptsPerBackend: 2
```

Cross-field rules the schema cannot express are validated when the section is written (the card keeps the rejected drafts) and at composition load: `effortLevel` belongs to the `openai` preset, `effortEnabled` to `mimo`/`qwen-local`/`anthropic`, `thinkingBudget` to `qwen-local`/`anthropic`; the `openai` and `mimo` presets ride either OpenAI protocol, `qwen-local` only chat completions, `anthropic` only Messages.

## Effort presets

Vendors grade effort differently, so the config names a preset, not a raw value:

- `openai` → `reasoning_effort` (chat) or `reasoning.effort` (Responses) at the chosen level.
- `mimo` → off maps to `none`, on to `low`: Xiaomi MiMo's server treats low/medium/high identically, so only the toggle is meaningful. MiMo is a preset, not a protocol — pair it with either OpenAI protocol.
- `qwen-local` → `chat_template_kwargs: { enable_thinking, thinking_budget? }`, chat completions only.
- `anthropic` → `thinking: { type: 'enabled', budget_tokens }` when on; the temperature is then omitted, as the Messages API requires.

## Input guard

`maxInputTokens` compares against an estimate, not a billed figure: text (instruction plus prompt) at 4 chars per token, plus the image at 750 pixels per token with dimensions probed from the PNG/JPEG/GIF/WebP header; an unreadable header falls back to the encoded byte count at the text rate. The refusal happens before any request leaves and skips the backend's remaining attempts; only the next priority, with its own limit, can still serve the input.

## Wire mapping

Chat completions: `model`; a system message carrying `instruction`; one user message with the content parts `[image_url (data URL), text (prompt ?? "Describe this image in detail.")]`; `max_tokens`; `temperature`; `stream: false`; plus the effort fragment. The reply maps through `choices[0].message.content` — a plain string, or an array whose `text` parts are joined — falling back to `reasoning_content` then `reasoning`, because thinking models served the OpenAI-compatible way sometimes carry the whole answer in a reasoning field.

Responses: `model`; `instructions`; one `input` message with `[input_image (data URL), input_text]` parts; `max_output_tokens`; `stream: false`; no temperature. The reply reads `output_text`, else walks the `output[]` message items for `output_text` parts.

Anthropic Messages: `model`; `max_tokens`; `system`; one user message with `[image (base64 source), text]` blocks; `temperature` only when thinking is off; headers carry `x-api-key`, `authorization: Bearer`, and `anthropic-version: 2023-06-01`. The reply joins the `text` blocks of `content`, dropping thinking blocks.

Every protocol reports `VisionDescription.model` from the server-reported `model` when present, else the configured id; an unusable or absent description throws `VisionError` `VISION_PROVIDER_ERROR`. HTTP errors surface the server's nested `error.message` (string or object) or top-level `message`, falling back to the status line; network and body-parse failures are `VISION_PROVIDER_ERROR`; caller cancellation and the attempt's own deadline are `VISION_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted.

## Model Experience

Indirectly, through [`dsh-tool-vision`](../tool-vision/README.md), which renders this provider's description text and served-model attribution inside the `view_image` tool result. Each describe call is an independent request to the sidecar endpoint and never enters the main model's requests directly.

#### KV Cache effect

No direct invalidation of the main model's cache; the sidecar request is independent. The named consumer owns any main-request prefix changes.

## Known Limitations and Deferred Work

- **One image per call, no sidecar state** — the endpoint sees each describe independently; image-token caching across calls is the server's business and the seam does not model it.
- **No image recompression** — bytes are sent as-is; `maxInputTokens` refuses an oversized describe instead of shrinking it, so size policy lives with the caller, or with the next chain priority carrying a wider limit.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` (or an already-aborted fused signal) maps to `VISION_ABORTED`; other abort shapes surface as `VISION_PROVIDER_ERROR`.
- **The input estimate is heuristic** — 4 chars per token and 750 pixels per token are calibrated coarse; the guard catches grossly oversized inputs, not billing-accurate ones.
