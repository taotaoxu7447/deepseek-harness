# Vision

English | [中文](vision.zh.md)

The vision seam turns an image into model-facing text through a swappable vision-model backend. It exists so a text-only main route can still reason about image files: a sidecar vision model produces the description, the main model consumes it as ordinary tool-result text through [`view_image`](../tool-catalog.md#deepseek-aidsh-tool-vision).

Source: [`packages/vision/vision/src/index.ts`](../../packages/vision/vision/src/index.ts)

## Provider selection

Providers register into `ctx.vision` and validate nothing about the image — media-type and byte-cap validation belong to the caller ([`dsh-tool-vision`](../../packages/vision/tool-vision/README.md) defers to the attachment service's image policy before describing). Selection resolves at execution time and never depends on registration order: a configured `provider` id must be registered and available (`VISION_PROVIDER_CONFIGURED_MISSING` / `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`); without one, exactly one usable provider must be registered (`VISION_PROVIDER_UNAVAILABLE`, `VISION_PROVIDER_AMBIGUOUS`). A duplicate registration id throws `VISION_DUPLICATE_PROVIDER`; failures inside the backend call surface as `VISION_ABORTED` (cancellation and the provider's own deadline) or `VISION_PROVIDER_ERROR`.

## Deployment

Mount the seam plus a provider, and the tool over it:

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
  config:
    model: qwen2.5-vl-7b-instruct
    baseURL: 'http://127.0.0.1:8000/v1'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvision--visionruntime"></a>

### `ctx.vision` — `VisionRuntime`

The vision service. Registered as `ctx.vision` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `VISION_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `VISION_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `VISION_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a vision provider. Throws {@link VisionError}
 * `VISION_DUPLICATE_PROVIDER` if its id is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: VisionProvider): () => void

/**
 * Describe one image through the selected provider. Resolves the provider at
 * call time with the selection rules above; throws {@link VisionError} when
 * the capability cannot run or the provider call fails.
 * @param request - the image and optional focus prompt.
 * @param signal - optional cancellation forwarded to the provider.
 * @returns the description text and the producing model.
 */
async describe(request: VisionDescribeRequest, signal?: AbortSignal): Promise<VisionDescription>

/**
 * Whether selection would succeed right now — the non-throwing form of the
 * same rules {@link describe} resolves with. Admission surfaces use it to
 * decide whether an image has an out-of-band path into the conversation
 * before any message is logged.
 * @returns true when a configured-or-single usable provider exists.
 */
hasUsableProvider(): boolean
```

Source: [`packages/vision/vision/src/index.ts:53`](../../packages/vision/vision/src/index.ts)
<!-- END GENERATED cordis-surface -->
