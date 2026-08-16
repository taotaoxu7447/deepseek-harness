# Agent Note: Vision sidecar seam - view_image over a describe capability

Status: implemented

English | [中文](2026-08-16-vision-sidecar-seam.zh.md)

## Problem

`deepseek-v4-flash` on the `deepseek-official` route is text-only, so `read_image` refuses: its result carries an `ImageBlock`, and the DeepSeek chat-completions adapter rejects image content with `UNSUPPORTED_CONTENT`. The refusal is correct — returning an image on a route that cannot carry it would break that route's continuation — but it leaves a text-only agent blind to every image file (screenshots, diagrams, UI captures), which is exactly the work users bring to a coding harness.

The harness needs image understanding on text-only routes without widening the main route's wire contract. Three shapes were on the table:

1. Route the vision model through `dsh-llm-pi-ai` as a second multimodal provider route and have a tool shuttle images to it through `ctx.llm`.
2. Caption images transparently by intercepting `read_image` results (`tools/post-execute`) on text-only routes.
3. A dedicated vision capability seam with a text-only consumer tool.

## Decision

A first-class capability seam, mirroring the web seam ([web capability seam](../architecture/2026-06-24-web-capability-seam.md)):

1. `@deepseek-ai/dsh-vision` (`packages/vision/vision`) owns `ctx.vision`: provider registration, execution-time selection (configured id, or exactly one usable provider — `VISION_PROVIDER_CONFIGURED_MISSING` / `_UNAVAILABLE` / `_AMBIGUOUS` / `VISION_PROVIDER_UNAVAILABLE`), one `describe({ image: { bytes, mediaType }, prompt? })` operation, and the `VisionError` taxonomy.
2. `@deepseek-ai/dsh-vision-qwen` (`packages/vision/vision-qwen`) implements the provider over an OpenAI-compatible `/chat/completions` endpoint (local vLLM/SGLang Qwen VL or equivalent): base64 data-URL image part, system instruction + focus prompt, non-streaming completion, string-or-parts content mapping, deadline backstop, abort/HTTP error taxonomy. `model` and `baseURL` have no defaults — they name one deployment, so absence fails at load; an empty API key sends no `Authorization` header because keyless local endpoints are a supported deployment.
3. `@deepseek-ai/dsh-tool-vision` (`packages/vision/tool-vision`) owns the model-facing `view_image` tool: path resolution and byte read through `ctx.fs`, admission and magic-byte validation through the attachment service's `imageLimits`/`validateImage` (no persistence — nothing references the bytes afterward), then `ctx.vision.describe`. The result is text only.

**Validation without persistence.** `read_image` durably commits bytes because its `ImageBlock` references them from the session log; `view_image` has no such reference, so saving would write orphaned content-addressed objects. `validateImage` (magic bytes, decode completion, policy limits) is reused without `saveImage`; the session keeps the description only — model-visible ⟺ logged holds because the image never becomes model-visible on the main route.

**The attachments-conditional registration.** Same composition-conditional gate as `read_image`: without a mounted attachment store there is no authoritative image policy to validate against, so the tool never registers.

**Settings-driven configuration over load-time facts.** `vision-qwen` layers its composition entry under a `vision-qwen` user-settings section through `installSettingsSection` (the `llm-deepseek` / `web-search-deepseek` pattern): the provider projects the section per describe, so model, endpoint, enablement, and key changes reach the next call without a restart, and an unconfigured section parks the provider (`available() === false`) instead of failing the load — the web Plugins settings card (enable toggle, model, endpoint, key through the credentials domain) is the intended place to finish setup. This trades the earlier fail-loud-at-load for a clean selection refusal with a pointer at that page, which is the right loudness when the configuration surface is a UI. Serving a namespace to the browser is an explicit decision in `WEB_SETTINGS_NAMESPACES` (`dsh-apiproxy`), so each section must be added there too.

**Multiple backends by composition, selection by enablement.** One plugin row per vision backend (`id` + `settingsSection` + `apiKeyEnv` config) yields one settings card each; the seam's exactly-one-usable rule makes the enable toggles the selection — several enabled without the seam's `provider` pin refuse with `VISION_PROVIDER_AMBIGUOUS` rather than guessing an order. The provider package stays OpenAI-compatible-generic (the Qwen name is its origin, not its protocol).

**Pasted-image admission as a view_image pointer.** A pasted image on a text-only route cannot simply be admitted: the log's image block would make every later request fail at the DeepSeek adapter, which is exactly why the product refuses it at the door. The bridge (`dsh-apiproxy` `prompt`) admits the image only when `ctx.vision.hasUsableProvider()` holds, stores it durably, and logs a one-line **pointer** — name, dimensions, and the `attachment_id` argument for `view_image` — in place of the image block. The main model decides when to look and with which focus question, through the same priority chain as file-based views; the describing call happens inside the turn as an ordinary tool call with visible progress. This replaced an earlier describe-at-admission draft, which blocked the paste RPC on the vision model for its whole description (a local 27B Q4 takes tens of seconds — the client's 30 s unary cap timed out, the transcript rendered nothing, and the message surfaced only later as queued). The pointer needs an id-only fetch, so the attachment seam gained `readImageById` (the store rebuilds the canonical reference from the stored bytes). Drag-drop rides the same client path. Residual tradeoff: the transcript shows the pointer text rather than an inline image preview.



## Alternatives considered

**Routing the vision model through `ctx.llm` with a `dsh-llm-pi-ai` provider route.** It composes, but it couples the consumer to a specific adapter package's composition (the route must exist and declare `input: [text, image]` before the tool works), drags the full adapter surface (streaming, tool schemas, reasoning efforts) into what is a one-shot describe call, and gives the sidecar a provider-route identity that the main loop's model selection could accidentally route to. A vision sidecar is not another route for the agent; it is a capability the agent's tool calls. The seam keeps the wire format behind a provider package exactly as search vendors sit behind `ctx.web`.

**Transparent captioning of `read_image` results via `tools/post-execute`.** `read_image` refuses at execution time on text-only routes — there is no successful result to caption, and rewriting another tool's refusal from outside would fight its documented route gate. Transparent captioning also hides from the model that a second model produced the text; `view_image`'s schema and prompt guidance say so, which keeps the model appropriately skeptical of sidecar claims.

**Returning the image block too on image-capable routes.** One tool, one contract. On an image-capable route `read_image` remains the better tool (the model sees the image itself); `view_image`'s value is precisely that it works everywhere, and its `model` envelope line attributes the description to its real author.

## Consequences

**A tool-call per image, per question.** Each `view_image` call re-uploads the image to the sidecar; multi-turn visual reasoning costs one sidecar request per turn. The seam models no sidecar state (see deferred work).

**Sidecar latency sits inside the tool budget.** Default `timeoutMs` is 120 s against the provider's 60 s HTTP backstop, so a large local model's first token cannot lose a race with the tool deadline; both are config.

**The viewed image is not recoverable from the session.** A human reviewing the log sees the description and path, not the pixels. If a future consumer needs durable images (for example a UI card), it can call `saveImage` itself; the seam does not force it.

## Deferred work

- A keyless ACP/headless snapshot scenario through a runnable example (a fixture server speaking the OpenAI-compatible describe protocol), per the assembled-transcript testing policy.
- Batch describe (several images in one sidecar request) and sidecar-side image-token reuse, if a consumer ever needs them.
- A client vision-result card carrying path/mediaType/model; presenters currently render the generic read card.
- `view_image` for remote images (URL argument) once a raw-bytes download path exists; today the model fetches to disk first.

## Open questions

- Should the base bundle compose `dsh-vision` + `dsh-vision-qwen` behind a settings section (like `llm-deepseek`), or stay opt-in through user patches? Today: opt-in.
- Should `read_image`'s refusal message on text-only routes point at `view_image` when it is registered? The coupling is prompt-level and cheap, but the tools are strangers by composition.
