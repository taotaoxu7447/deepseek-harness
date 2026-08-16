# Vision

[English](vision.md) | 中文

视觉接缝通过可替换的视觉模型后端把图片转换为面向模型的文本。它的存在让纯文本主路由也能推理图片文件:侧车视觉模型生成描述,主模型经 [`view_image`](../tool-catalog.md#deepseek-aidsh-tool-vision) 把它当作普通工具结果文本来消费。

来源:[`packages/vision/vision/src/index.ts`](../../packages/vision/vision/src/index.ts)

## Provider selection

Provider 注册进 `ctx.vision`,且不校验图片本身 —— 媒体类型与字节上限校验属于调用方([`dsh-tool-vision`](../../packages/vision/tool-vision/README.md) 在描述之前先走附件服务的图片策略)。选择在执行时解析,与注册顺序无关:配置的 `provider` id 必须已注册且可用(`VISION_PROVIDER_CONFIGURED_MISSING` / `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`);未配置时,必须恰好有一个可用 Provider(`VISION_PROVIDER_UNAVAILABLE`、`VISION_PROVIDER_AMBIGUOUS`)。重复的注册 id 抛出 `VISION_DUPLICATE_PROVIDER`;后端调用内部的失败呈现为 `VISION_ABORTED`(取消与 Provider 自身超时)或 `VISION_PROVIDER_ERROR`。

## Deployment

挂载接缝与一个 Provider,再挂载其上的工具:

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
