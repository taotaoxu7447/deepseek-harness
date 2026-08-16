# @deepseek-ai/dsh-vision-qwen

English | [中文](README.zh.md)

A `VisionProvider` for the harness [vision capability seam](../vision/README.md) (`ctx.vision`), backed by an OpenAI-compatible `/chat/completions` endpoint serving a Qwen vision model — a local vLLM/SGLang deployment, or any other server speaking the same wire format. The image rides the request as a base64 data URL; the reply text becomes the description.

This is an **implementation** package: it registers a provider into `ctx.vision`, it does not own the `ctx.vision` key and it does not register a model-facing tool (that is [`dsh-tool-vision`](../tool-vision/README.md)). It is a function/namespace plugin (`inject: ['vision']`) that registers its backend, not a default-export service.

Connection facts resolve per call, layered: the `cordis.yml` entry config under the optional `vision-qwen` user-settings section (`ctx.settings`) — the web **Settings → Plugins → Vision** card edits it — with the API key resolved through the credential seam. A changed model, endpoint, enablement, or key reaches the very next describe without a restart. A composition without `model`/`baseURL` parks the provider (registered, but refusing selection with a pointer at the settings page) instead of failing the load: the settings card is the intended place to finish configuring it.

## Config

| Key | Default | Meaning |
|---|---|---|
| `id` | `qwen` | Registry id this instance registers under; distinct per composed instance. |
| `settingsSection` | `vision-qwen` | Settings-section name this instance owns; distinct per composed instance, and each must be served to editing clients. |
| `enabled` | `true` | False parks the provider: registered, but refusing selection. The settings card's toggle. |
| `model` | (unset) | Vision model id the endpoint serves. The one fact with no default; unset parks the provider. |
| `baseURL` | `$QWEN_BASE_URL` | Endpoint base; `/chat/completions` is appended. Unset parks the provider. |
| `apiKey` | (unset) | Literal API key; prefer `apiKeyEnv` so no secret enters configuration files. Empty string counts as unset. |
| `apiKeyEnv` | `QWEN_API_KEY` | Credential reference resolved for each describe. An empty answer sends no `Authorization` header — a keyless local endpoint works without any key. |
| `instruction` | built-in | System instruction for the describe call. The default frames a factual, transcription-heavy description for a coding agent. |
| `temperature` | `0.2` | Sampling temperature, within `[0, 2]`. |
| `maxTokens` | `1024` | Completion budget (tokens) for one description. |
| `timeoutMs` | `60000` | HTTP budget for one describe call; firing maps to `VISION_ABORTED`. |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

No config is required at composition: finish setup on the Plugins settings card (enable, model, endpoint, key) and the values persist in the user settings document with hot effect.

## Multiple backends

Compose the plugin once per vision backend — a second row with its own `id`, `settingsSection`, and `apiKeyEnv` (so each card's key control writes its own credential) gets its own settings card:

```yaml
- id: vision-chatgpt
  name: '@deepseek-ai/dsh-vision-qwen'
  config:
    id: chatgpt-luna
    settingsSection: vision-chatgpt
    apiKeyEnv: CHATGPT_API_KEY
    enabled: false
```

Selection is the enable toggles: exactly one enabled backend serves `view_image`; several enabled without the seam's `provider` pin refuse with `VISION_PROVIDER_AMBIGUOUS` (park one), none with `VISION_PROVIDER_UNAVAILABLE`.

## Wire mapping

The request is a non-streaming chat completion: `model`; a system message carrying `instruction`; one user message with the content parts `[image_url (data URL), text (prompt ?? "Describe this image in detail.")]`; `max_tokens`; `temperature`; `stream: false`. The reply maps through `choices[0].message.content` — a plain string, or an array whose `text` parts are joined — into `VisionDescription.text`; a blank `content` falls back to `reasoning_content` then `reasoning`, because thinking models served the OpenAI-compatible way sometimes carry the whole answer in a reasoning field, with `VisionDescription.model` from the server-reported `model` when present, else the configured id. An unusable or absent description throws `VisionError` `VISION_PROVIDER_ERROR`. HTTP errors surface the server's nested `error.message` (string or object) or top-level `message`, falling back to the status line; network and body-parse failures are `VISION_PROVIDER_ERROR`; caller cancellation and the provider's own deadline are `VISION_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted.

## Model Experience

Indirectly, through [`dsh-tool-vision`](../tool-vision/README.md), which renders this provider's description text and served-model attribution inside the `view_image` tool result. Each describe call is an independent request to the sidecar endpoint and never enters the main model's requests directly.

#### KV Cache effect

No direct invalidation of the main model's cache; the sidecar request is independent. The named consumer owns any main-request prefix changes.

## Known Limitations and Deferred Work

- **One image per call, no sidecar state** — the endpoint sees each describe independently; image-token caching across calls is the server's business and the seam does not model it.
- **No image resizing** — bytes are sent as-is within the attachment policy's byte cap; a huge image costs the sidecar whatever the server charges for it.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` (or an already-aborted fused signal) maps to `VISION_ABORTED`; other abort shapes surface as `VISION_PROVIDER_ERROR`.
- **Only the OpenAI-compatible protocol** — native vendor protocols (DashScope multimodal, Anthropic content blocks) wait on separate provider packages.
