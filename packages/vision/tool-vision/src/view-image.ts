/**
 * The model-facing `view_image` tool: reads a PNG/JPEG/WebP/GIF file, validates
 * it against the deployment's image policy through the attachment service
 * (without persisting it), and returns the vision model's text description of
 * its content. The result is text only, so the tool works on any model route —
 * including text-only routes where `read_image`'s image block cannot travel.
 * @module @deepseek-ai/dsh-tool-vision/src/view-image
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { FsError } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import { VisionError } from '@deepseek-ai/dsh-vision'
import type {} from '@deepseek-ai/dsh-vision'

/** Extensions `view_image` accepts; magic-byte validation at the attachment service stays authoritative. */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** The canonical outcome declared by the `view_image` output schema. */
export interface ViewImageValue {
  /** The file that was viewed; absent for an attachment-only view. */
  path?: string
  /** The durable attachment that was viewed; absent for a file-path view. */
  attachment?: {
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
    name?: string
  }
  mediaType: string
  model: string
  description: string
}

/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/**
 * Validate value constraints the schema DSL can't express: exactly one of
 * `file_path` / `attachment_id` non-blank, and a `question` that is either
 * absent or non-blank.
 *
 * @param args - the schema-validated `view_image` arguments.
 * @returns the image source plus the focus prompt, when given.
 */
export function parseViewImageArgs(args: {
  file_path?: string
  attachment_id?: string
  question?: string
}): { filePath?: string; attachmentId?: string; prompt?: string } {
  const question = args.question?.trim() ?? ''
  const filePath = args.file_path?.trim() ?? ''
  const attachmentId = args.attachment_id?.trim() ?? ''
  if (filePath.length === 0 && attachmentId.length === 0) {
    throw new Error('exactly one of file_path or attachment_id must be a non-empty string')
  }
  if (filePath.length > 0 && attachmentId.length > 0) {
    throw new Error('pass either file_path or attachment_id, not both')
  }
  return {
    ...filePath.length > 0 ? { filePath } : {},
    ...attachmentId.length > 0 ? { attachmentId } : {},
    ...question.length > 0 ? { prompt: question } : {},
  }
}

/**
 * Resolve a model-supplied path and require an existing regular file.
 * Relative paths resolve against the calling agent's session workspace, the
 * same base the `read`/`write`/`edit` tools use.
 *
 * @param ctx - the plugin context providing filesystem resolution.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its stat result.
 */
async function resolveImageTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: Awaited<ReturnType<Context['fs']['resolve']>>; info: NonNullable<Awaited<ReturnType<Context['fs']['stat']>>> }> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot view "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot view "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}

/** The truncation notice appended when the output cap cut the description. */
const TRUNCATION_FOOTER = '\n\n(Description truncated by the view_image output cap.)'

/**
 * Format a description as the model-facing envelope, bounded as a whole.
 *
 * @param value - the canonical view-image outcome.
 * @param maxOutputChars - cap on the complete returned string.
 * @returns the complete text: path, describing model, description, and a
 *   truncation footer when the cap cut the description.
 */
export function formatViewImageOutput(value: ViewImageValue, maxOutputChars: number): string {
  const label = value.path !== undefined
    ? `<path>${value.path}</path>`
    : `<attachment>${value.attachment?.name ?? value.attachment?.attachmentId ?? ''} (${value.attachment?.width ?? 0}x${value.attachment?.height ?? 0}, ${value.mediaType})</attachment>`
  const header = `${label}\n<model>${value.model}</model>\n<description>\n`
  const footer = '\n</description>'
  const full = `${header}${value.description}${footer}`
  if (full.length <= maxOutputChars) return full
  const budget = maxOutputChars - header.length - footer.length - TRUNCATION_FOOTER.length
  if (budget > 0) return `${header}${value.description.slice(0, budget)}${footer}${TRUNCATION_FOOTER}`
  return full.slice(0, maxOutputChars)
}

/**
 * Project one canonical description into its model-facing content blocks.
 * @param value - the canonical view-image outcome.
 * @param maxOutputChars - cap on the complete rendered text.
 * @returns the single text block used by native and nested dispatches.
 */
function viewImageContent(value: ViewImageValue, maxOutputChars: number) {
  return [{ type: 'text' as const, text: formatViewImageOutput(value, maxOutputChars) }]
}

/**
 * Selection failures the tool rewords for the configuring human: the seam's
 * generic registry messages name no place to fix the problem.
 */
const SELECTION_CODES: ReadonlySet<string> = new Set([
  'VISION_PROVIDER_UNAVAILABLE',
  'VISION_PROVIDER_AMBIGUOUS',
  'VISION_PROVIDER_CONFIGURED_MISSING',
  'VISION_PROVIDER_CONFIGURED_UNAVAILABLE',
])

/**
 * Describe one image through the seam, rewording a selection failure into the
 * action that fixes it.
 *
 * @param ctx - the plugin context providing the vision seam.
 * @param image - the validated image bytes and their media type.
 * @param prompt - the optional focus prompt.
 * @param signal - cancellation forwarded to the provider.
 * @returns the description text and the producing model.
 */
async function describeThroughSeam(
  ctx: Context,
  image: { bytes: Uint8Array; mediaType: string },
  prompt: string | undefined,
  signal: AbortSignal,
): Promise<{ text: string; model: string }> {
  try {
    return await ctx.vision.describe(
      { image, ...prompt !== undefined ? { prompt } : {} },
      signal,
    )
  } catch (error: unknown) {
    if (error instanceof VisionError && SELECTION_CODES.has(error.code)) {
      throw new Error(
        `cannot view this image: ${error.message}; enable and configure the vision provider on the deployment's Plugins settings page (or set model/baseURL for vision-qwen)`,
        { cause: error },
      )
    }
    throw error
  }
}

/**
 * Register the `view_image` tool and its system-prompt guidance. The composing
 * plugin owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while the
 * deployment's authoritative image policy is mounted. Execution re-checks
 * `ctx.get('attachments')` for direct callers.
 *
 * @param ctx - the registration scope; execution uses its `fs` and `vision`
 *   services plus the optional `attachments` service.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the
 *   tool's `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param maxOutputChars - cap on the complete rendered tool output.
 */
export function applyViewImageTool(ctx: Context, timeoutMs: number, maxOutputChars: number): void {
  ctx.systemPrompt.section({
    name: 'tool:view_image',
    order: 112,
    text: 'Use the view_image tool to understand what a PNG/JPEG/WebP/GIF image looks like: it sends the image to a separate vision model and returns a detailed text description, with any text in the image transcribed. Uploaded images arrive as pointers naming an attachment id — pass that id verbatim as view_image\'s attachment_id argument. Pass the optional question argument when you need one specific fact. The description comes from another model; treat surprising claims as worth verifying when the file itself is available.',
  })

  ctx.tools.register(defineTool({
    name: 'view_image',
    description: 'View a PNG/JPEG/WebP/GIF image with a vision model and return a detailed text description of its visual content, including text in the image. Takes either a file path or the attachment_id of an uploaded image. Works even when the current model cannot accept image input.',
    parameters: {
      file_path: { type: 'string', description: 'Path to the image file, resolved by the filesystem backend. Exactly one of file_path or attachment_id.' },
      attachment_id: { type: 'string', description: 'Id of an uploaded image, copied verbatim from the uploaded-image pointer in the conversation. Exactly one of file_path or attachment_id.' },
      question: { type: 'string', description: 'Optional question about the image; the description focuses on answering it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          attachment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          mediaType: { type: 'string', required: true },
          model: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      },
      render: (_args, value) => viewImageContent(value, maxOutputChars),
    },
    timeoutMs,
    // Reads and a sidecar describe do not mutate agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseViewImageArgs(args)
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('cannot view an image: no attachment service is mounted')
      }

      // The attachment branch: bytes already passed admission validation and
      // live in the durable store, so the read itself is the only I/O.
      if (input.attachmentId !== undefined) {
        let stored: Awaited<ReturnType<typeof attachments.readImageById>>
        try {
          stored = await attachments.readImageById(AttachmentId(input.attachmentId), exec.signal)
        } catch (error: unknown) {
          if (error instanceof AttachmentError && error.code === 'ATTACHMENT_NOT_FOUND') {
            throw new Error(`cannot view attachment "${input.attachmentId}": no stored image matches that id; the id must be copied verbatim from the uploaded-image pointer`)
          }
          throw error
        }
        const description = await describeThroughSeam(
          ctx,
          { bytes: stored.data, mediaType: stored.ref.mediaType },
          input.prompt,
          exec.signal,
        )
        const value: ViewImageValue = {
          attachment: {
            attachmentId: String(stored.ref.attachmentId),
            mediaType: stored.ref.mediaType,
            bytes: stored.ref.bytes,
            width: stored.ref.width,
            height: stored.ref.height,
            ...stored.ref.name === undefined ? {} : { name: stored.ref.name },
          },
          mediaType: stored.ref.mediaType,
          model: description.model,
          description: description.text,
        }
        if (exec.parent !== undefined) {
          exec.deferContext(createUserMessage({
            content: viewImageContent(value, maxOutputChars),
            source: { kind: 'plugin', plugin: 'tool-vision' },
          }))
        }
        return value
      }

      // The file branch: every gate runs before any filesystem I/O so a
      // refusal never leaks partial reads.
      const filePath = input.filePath ?? ''
      const mediaType = imageMediaTypeForPath(filePath)
      if (mediaType === undefined) {
        throw new Error(`cannot view "${filePath}": view_image only accepts PNG/JPEG/WebP/GIF paths`)
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot view "${filePath}": ${mediaType} images are not accepted by this deployment`)
      }

      const { target, info } = await resolveImageTarget(ctx, exec, filePath)
      const data = await ctx.fs.readBytes(target, exec.signal, attachments.imageLimits.maxImageBytes)
      try {
        await attachments.validateImage({ data, mediaType, name: basename(target.displayPath) })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError) || error.code !== 'IMAGE_TYPE_MISMATCH') throw error
        const extension = extname(target.displayPath).toLowerCase()
        throw new Error(
          `cannot view "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`,
          { cause: error },
        )
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)

      const description = await describeThroughSeam(ctx, { bytes: data, mediaType }, input.prompt, exec.signal)
      const value: ViewImageValue = {
        path: target.displayPath,
        mediaType,
        model: description.model,
        description: description.text,
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: viewImageContent(value, maxOutputChars),
          source: { kind: 'plugin', plugin: 'tool-vision' },
        }))
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along
    // location on the image file.
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `View image ${args.attachment_id ?? args.file_path ?? ''}`,
        kind: 'read',
        ...args.file_path !== undefined ? { locations: [{ path: args.file_path }] } : {},
      }
    },
  }))
}
