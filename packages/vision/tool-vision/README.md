# @deepseek-ai/dsh-tool-vision

English | [中文](README.zh.md)

Model-facing `view_image` tool over the harness [vision capability seam](../vision/README.md) (`ctx.vision`): reads a PNG/JPEG/WebP/GIF file through `ctx.fs`, validates it against the deployment's image policy through the attachment service (without persisting it), asks the mounted vision model to describe it, and returns the description as text.

The result is text only, so `view_image` works on any model route — including text-only routes (for example `deepseek-v4-flash` on `deepseek-official`) where `read_image` refuses because its image block cannot travel. On an image-capable route, `read_image` remains the better tool: the model sees the image itself.

This package owns schemas, validation, prompt guidance, and presentation, never a concrete vision backend (mount a provider such as [`dsh-vision-qwen`](../vision-qwen/README.md)).

## Config

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Cooperative tool-call budget, enforced by `@deepseek-ai/dsh-tool-call-timeout-policy`. Comfortably above the Qwen provider's default 60 s HTTP budget. |
| `maxOutputChars` | `8192` | Cap on the complete rendered tool output; a cut description gains a truncation footer. |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

Configure the provider on the web **Settings → Plugins → Vision** card (enable, model, endpoint, key); values take effect without a restart.

The tool registers only while the `attachments` service is mounted (same composition-conditional gate as `read_image`): without it the deployment has no authoritative image policy to validate bytes against. Execution gates before any filesystem I/O: the extension must claim an image media type, the deployment must admit it, and the attachment service's magic-byte validation must confirm the declared format — a mismatch produces a rename-or-convert hint rather than a sidecar call.

## Model Experience

### System prompt

#### What the model sees

The tool contributes the view-image guidance below whenever it is registered.

##### Verbatim view-image guidance

```markdown
Use the view_image tool to understand what a PNG/JPEG/WebP/GIF image file looks like: it sends the image to a separate vision model and returns a detailed text description, with any text in the image transcribed. Pass the optional question argument when you need one specific fact. The description comes from another model; treat surprising claims as worth verifying when the file itself is available.
```

#### Token effect

Fixed guidance cost per request while the tool is registered, even when a scoped restriction hides its schema.

#### KV Cache effect

Prefix-stable while the tool, scope, and guidance text are unchanged; plugin lifecycle (including the attachments-conditional registration) may invalidate reuse from this section onward.

### Tool schemas

#### What the model sees

The model sees the generated [`view_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-vision). The output budget is a deployment setting, not a model argument.

#### Token effect

Fixed schema cost per request; registration composition or a scoped restriction removes it.

#### KV Cache effect

Prefix-stable while the definition and its visibility are unchanged; plugin lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### View result

#### What the model sees

A successful view is exactly `<path><displayPath></path>`, `<model><servedVisionModel></model>`, `<description>`, the provider-owned description text, `</description>` on separate lines. A capped description appends a blank line and `(Description truncated by the view_image output cap.)`; failures become `Error: <message>` (blank paths, non-image extensions, refused media types, missing or non-regular files, format mismatches, `VISION_*` provider failures). Call arguments stay in call history; the image itself never enters the main request.

#### Token effect

The provider caps description length (`maxTokens`); the rendered result is capped by `maxOutputChars`; retained call results are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries. The sidecar describe call is an independent model request with no effect on the main cache.

## Known Limitations and Deferred Work

- **Local files only** — `view_image` takes a path resolved by `ctx.fs`; viewing a remote image needs it fetched to disk first (no raw-bytes download tool ships today).
- **The viewed image is not durably stored** — only the description is logged; unlike `read_image`, no attachment reference enters the session (a text-only route could not carry it anyway).
- **UI shows no image card** — the presenters render a generic read card; a vision-result card carrying the path and model waits on a client card type that does not exist yet.
- **No keyless snapshot scenario yet** — package tests and the real-Loader guard cover the assembled paths; an ACP/headless snapshot through a runnable example is deferred until a fixture server lands in `examples/`.
