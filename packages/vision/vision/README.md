# @deepseek-ai/dsh-vision

English | [中文](README.zh.md)

Service Definition for the vision capability seam (`ctx.vision`): a provider registry and one `describe` operation that turns an encoded image plus an optional focus prompt into model-facing text through a swappable vision-model backend. It exists so a text-only main route (for example `deepseek-v4-flash`) can still reason about image files: the sidecar vision model produces the description, the main model consumes it as ordinary tool-result text.

This package owns the `ctx.vision` key. It ships no provider (mount one, for example [`dsh-vision-qwen`](../vision-qwen/README.md)) and no model-facing tool (that is [`dsh-tool-vision`](../tool-vision/README.md)).

## Service API

`VisionRuntime extends Service`, registered as `ctx.vision`:

- `registerProvider(provider: VisionProvider): () => void` — registers one backend under its `id`; a duplicate id throws `VisionError` `VISION_DUPLICATE_PROVIDER`. The disposer unregisters; registration is an effect, so it also unwinds when the registering plugin is disposed.
- `describe(request: VisionDescribeRequest, signal?: AbortSignal): Promise<VisionDescription>` — resolves the provider at call time, then delegates. `request` is `{ image: { bytes, mediaType }, prompt? }`; the result is `{ text, model }`.

A `VisionProvider` is `{ id, available(): boolean, describe(request, signal?) }`. Providers validate nothing about the image: media-type and byte-cap validation belong to the caller — `view_image` defers to the attachment service's image policy before describing.

Selection semantics (never order-dependent): a configured `provider` id must be registered and available (`VISION_PROVIDER_CONFIGURED_MISSING` / `VISION_PROVIDER_CONFIGURED_UNAVAILABLE` otherwise); without one, exactly one usable provider must be registered (`VISION_PROVIDER_UNAVAILABLE` when none, `VISION_PROVIDER_AMBIGUOUS` when several). Beyond selection, a provider may refuse a call before any request leaves — the chain provider's estimated-input guard throws `VISION_INPUT_TOO_LARGE` (formula in [its README](../vision-qwen/README.md#input-guard)).

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | (unset) | Pin the provider id for `describe`. Unset auto-selects when exactly one usable provider is registered. |

## Pasted-image admission bridge

The web host (`dsh-apiproxy`) consults this seam at image admission: on a text-only model route, a pasted or dropped image is refused (`MODEL_DOES_NOT_SUPPORT_IMAGES`) unless `hasUsableProvider()` holds — in which case the image is validated and durably stored, and the session logs a one-line **pointer** in place of the image block: the file name, dimensions, media type, and the `view_image` `attachment_id` argument that fetches it. The main model decides when (and with which focus question) to look, through the same priority chain as every other view, so admission is instant and the vision call happens inside the turn as an ordinary tool call. A describe at admission would block the paste on the vision model; the pointer keeps `view_image` the single path. The attachment seam gained `readImageById` for exactly this fetch: the pointer names only the id, and the store rebuilds the canonical reference from the stored bytes.

## Extension points## Extension points

Register another `VisionProvider` implementation to swap or add a vision backend (cloud VL APIs, a different local server) without touching the consumer. `available()` gates selection; a provider that needs a credential reports `false` until it has one.

## Model Experience

Indirectly, through [`dsh-tool-vision`](../tool-vision/README.md), which renders this seam's `VisionDescription` text and `model` attribution inside the `view_image` tool result the model sees.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **One image per describe call** — batching several images into one sidecar request waits on a consumer that needs it; the current tool describes one file per call.
- **No sidecar session or state** — each `describe` call is independent; multi-turn visual reasoning (follow-up questions reusing cached image tokens) would need provider-owned state the seam does not model.
