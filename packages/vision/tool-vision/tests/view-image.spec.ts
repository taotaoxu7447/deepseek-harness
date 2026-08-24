/**
 * The `view_image` tool over the REAL local filesystem and attachment store:
 * extension routing, validation refusals, description rendering, sidecar
 * failures, and nested Code Mode forwarding. The vision provider is stubbed at
 * the seam: it is the external-model boundary this package never owns.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import type { VisionDescribeRequest, VisionDescription, VisionProvider } from '@deepseek-ai/dsh-vision'
import * as ToolVision from '@deepseek-ai/dsh-tool-vision'
import { applyViewImageTool, formatViewImageOutput, imageMediaTypeForPath, parseViewImageArgs } from '../src/view-image.ts'

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const testToolSignal = new AbortController().signal

/** Captures every describe request; returns scripted descriptions per call. */
class RecordingProvider implements VisionProvider {
  readonly id = 'recording'
  readonly requests: VisionDescribeRequest[] = []
  private readonly responses: VisionDescription[]
  private cursor = 0

  constructor(responses: VisionDescription[]) {
    this.responses = responses
  }

  available(): boolean {
    return true
  }

  describe(request: VisionDescribeRequest): Promise<VisionDescription> {
    this.requests.push(request)
    const response = this.responses[Math.min(this.cursor, this.responses.length - 1)]
    this.cursor += 1
    return Promise.resolve(response ?? { text: '', model: '' })
  }
}

/** A failing provider for error-path tests. */
function failingProvider(error: Error): VisionProvider {
  return { id: 'failing', available: () => true, describe: () => Promise.reject(error) }
}

/** An attachment store whose admission policy rejects every media type. */
class RestrictedAttachmentStore extends AttachmentStore {
  readonly imageLimits = {
    mediaTypes: Object.freeze(['image/png']) as readonly ImageMediaType[],
    maxImageBytes: 1_000_000,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 2_000_000,
    maxImagePixels: 100_000_000,
    maxImageDimension: 2000,
  }

  async validateImage(_input: SaveImageAttachment): Promise<void> {}
  async saveImage(_input: SaveImageAttachment): Promise<never> {
    throw new Error('view_image never saves attachments')
  }

  async readImage(): Promise<never> {
    throw new Error('view_image never reads attachments back')
  }

  readImageById(): Promise<never> {
    return Promise.reject(new Error('readImageById unused in this test'))
  }
}

/** In-process Code Mode seam fake that invokes the real registry bindings. */
class FakeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-view-image-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-view-image-home-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/** 3x3 red PNG used to trip a tiny configured pixel limit. */
const PNG_3X3 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEElEQVR4nGP4z8AAQQxYWACPjgj4kWPEuQAAAABJRU5ErkJggg==', 'base64')

interface SetupOptions {
  config?: ToolVision.Config
  provider?: VisionProvider
  attachments?: 'local' | 'restricted' | false
  storeConfig?: { maxImagePixels?: number }
  toolMode?: 'native' | 'code'
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: options.toolMode ?? 'native' })
  if (options.toolMode === 'code') await ctx.plugin(FakeRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  if (options.attachments !== false) {
    await ctx.plugin(options.attachments === 'restricted' ? RestrictedAttachmentStore : LocalAttachmentStore, { dshHome: home, ...options.storeConfig })
  }
  await ctx.plugin(VisionRuntime)
  if (options.provider !== undefined) ctx.vision.registerProvider(options.provider)
  const fiber = await ctx.plugin(ToolVision, options.config ?? {})
  return { ctx, fiber }
}

/** A fake calling agent whose session workspace is the test dir. */
function agentInDir(): object {
  return {
    options: {},
    session: { header: { cwd: dir }, append: () => undefined },
  }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`view-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

function viewImage(ctx: Context, args: unknown, agent?: object) {
  return call(ctx, 'view_image', args, agent)
}

function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('argument and formatting helpers', () => {
  it('maps the four extensions case-insensitively and rejects everything else', () => {
    expect(imageMediaTypeForPath('a.png')).toBe('image/png')
    expect(imageMediaTypeForPath('a.JPG')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('b.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('c.webp')).toBe('image/webp')
    expect(imageMediaTypeForPath('d.Gif')).toBe('image/gif')
    expect(imageMediaTypeForPath('note.txt')).toBeUndefined()
    expect(imageMediaTypeForPath('png')).toBeUndefined()
  })

  it('requires a non-blank path and trims the question', () => {
    expect(() => parseViewImageArgs({ file_path: '  ' })).toThrow('non-empty')
    expect(parseViewImageArgs({ file_path: 'a.png' })).toEqual({ filePath: 'a.png' })
    expect(parseViewImageArgs({ file_path: 'a.png', question: '  ' })).toEqual({ filePath: 'a.png' })
    expect(parseViewImageArgs({ file_path: 'a.png', question: ' color? ' })).toEqual({ filePath: 'a.png', prompt: 'color?' })
  })

  it('formats the envelope whole and appends a footer only when the cap cuts', () => {
    const value = { path: 'a.png', mediaType: 'image/png', model: 'qwen', description: 'a red square' }
    expect(formatViewImageOutput(value, 8_192)).toBe('<path>a.png</path>\n<model>qwen</model>\n<description>\na red square\n</description>')
    const cut = formatViewImageOutput({ ...value, description: 'x'.repeat(200) }, 160)
    expect(cut).toContain('Description truncated')
    expect(cut.length).toBe(160)
    // A cap too small for header, footer, and notice degrades to a bounded slice.
    expect(formatViewImageOutput({ ...value, description: 'x'.repeat(200) }, 40).length).toBe(40)
  })
})

describe('view_image happy path', () => {
  it('describes the bytes through the vision seam and renders the envelope', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const provider = new RecordingProvider([{ text: 'a red square', model: 'qwen2.5-vl' }])
    const { ctx } = await setup({ provider })

    const result = await viewImage(ctx, { file_path: 'red.png' }, agentInDir())

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('<path>' + join(dir, 'red.png') + '</path>\n<model>qwen2.5-vl</model>\n<description>\na red square\n</description>')
    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]?.image.mediaType).toBe('image/png')
    expect(Buffer.from(provider.requests[0]?.image.bytes ?? []).toString('base64')).toBe(PNG_1X1.toString('base64'))
    expect(provider.requests[0]?.prompt).toBeUndefined()
  })

  it('forwards a focused question as the describe prompt', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const provider = new RecordingProvider([{ text: 'red', model: 'qwen2.5-vl' }])
    const { ctx } = await setup({ provider })

    const result = await viewImage(ctx, { file_path: 'red.png', question: 'what color?' }, agentInDir())

    expect(result.isError).toBe(false)
    expect(provider.requests[0]?.prompt).toBe('what color?')
  })

  it('resolves relative paths without an agent against the backend default', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const provider = new RecordingProvider([{ text: 'a red square', model: 'qwen2.5-vl' }])
    const { ctx } = await setup({ provider })

    const result = await viewImage(ctx, { file_path: 'red.png' })
    expect(result.isError).toBe(false)
  })

  it('caps the rendered description at the configured output budget', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const provider = new RecordingProvider([{ text: 'y'.repeat(500), model: 'qwen2.5-vl' }])
    const { ctx } = await setup({ provider, config: { maxOutputChars: 250 } })

    const result = await viewImage(ctx, { file_path: 'red.png' }, agentInDir())

    expect(result.isError).toBe(false)
    const rendered = text(result)
    expect(rendered.length).toBe(250)
    expect(rendered).toContain('Description truncated')
  })
})

describe('view_image refusal arms', () => {
  it('refuses paths that do not claim an image extension', async () => {
    const { ctx } = await setup({ provider: new RecordingProvider([]) })
    const result = await viewImage(ctx, { file_path: 'note.txt' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('only accepts PNG/JPEG/WebP/GIF paths')
  })

  it('refuses blank paths', async () => {
    const { ctx } = await setup({ provider: new RecordingProvider([]) })
    const result = await viewImage(ctx, { file_path: '  ' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty')
  })

  it('refuses media types the deployment does not admit', async () => {
    await writeFile(join(dir, 'shot.gif'), PNG_1X1)
    const provider = new RecordingProvider([])
    const { ctx } = await setup({ provider, attachments: 'restricted' })

    const result = await viewImage(ctx, { file_path: 'shot.gif' }, agentInDir())

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not accepted by this deployment')
    expect(provider.requests).toHaveLength(0)
  })

  it('refuses a missing file with FS_NOT_FOUND', async () => {
    const provider = new RecordingProvider([])
    const { ctx } = await setup({ provider })
    const result = await viewImage(ctx, { file_path: 'gone.png' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not found')
  })

  it('refuses a directory with FS_NOT_REGULAR_FILE', async () => {
    await mkdir(join(dir, 'folder.png'))
    const provider = new RecordingProvider([])
    const { ctx } = await setup({ provider })
    const result = await viewImage(ctx, { file_path: 'folder.png' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not a regular file')
  })

  it('refuses bytes whose format contradicts the extension', async () => {
    await writeFile(join(dir, 'fake.jpg'), PNG_1X1)
    const provider = new RecordingProvider([])
    const { ctx } = await setup({ provider })

    const result = await viewImage(ctx, { file_path: 'fake.jpg' }, agentInDir())

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('different image format')
    expect(provider.requests).toHaveLength(0)
  })

  it('propagates validation failures other than a format mismatch unchanged', async () => {
    await writeFile(join(dir, 'big.png'), PNG_3X3)
    const provider = new RecordingProvider([])
    const { ctx } = await setup({ provider, storeConfig: { maxImagePixels: 1 } })

    const result = await viewImage(ctx, { file_path: 'big.png' }, agentInDir())

    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('different image format')
    expect(provider.requests).toHaveLength(0)
  })

  it('refuses when no vision provider is registered', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const { ctx } = await setup()
    const result = await viewImage(ctx, { file_path: 'red.png' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no usable vision provider')
  })

  it('surfaces provider failures as tool errors', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const { ctx } = await setup({ provider: failingProvider(new Error('vision backend down')) })
    const result = await viewImage(ctx, { file_path: 'red.png' }, agentInDir())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('vision backend down')
  })

  it('refuses direct callers when no attachment service is mounted', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const { ctx } = await setup({ attachments: false, provider: new RecordingProvider([]) })
    // The composition-conditional registration never ran; exercise the
    // execute-time re-check by registering directly on the bare context.
    applyViewImageTool(ctx, 120_000, 8_192)

    const result = await viewImage(ctx, { file_path: 'red.png' }, agentInDir())

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no attachment service is mounted')
  })
})

/** The assembled system-prompt text, for section assertions. */
async function promptText(ctx: Context): Promise<string> {
  const prompt = await ctx.systemPrompt.assemble()
  return prompt.sections.map(section => section.text).join('\n')
}

describe('view_image attachment branch', () => {
  /** A recording provider over the real seam. */
  function recording(responses: { text: string; model: string }[]) {
    let cursor = 0
    return {
      provider: {
        id: 'recording',
        available: () => true,
        describe: () => {
          const response = responses[Math.min(cursor, responses.length - 1)]
          cursor += 1
          return Promise.resolve(response)
        },
      } as VisionProvider,
    }
  }

  it('describes a stored attachment by id through the vision seam', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
    const rec = recording([{ text: 'a red square', model: 'qwen2.5-vl' }])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await ctx.plugin(VisionRuntime)
    ctx.vision.registerProvider(rec.provider)
    await ctx.plugin(ToolVision)

    // Store one real image and take its id.
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected attachments')
    const ref = await attachments.saveImage({ data: new Uint8Array(PNG), mediaType: 'image/png', name: 'pasted.png' })

    let counter = 0
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(`att-call-${++counter}`),
      name: 'view_image',
      arguments: { attachment_id: String(ref.attachmentId), question: 'what is it?' },
    })

    expect(result.isError).toBe(false)
    const texts = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(texts).toContain('a red square')
    expect(texts).toContain('<attachment>')
    await ctx.fiber.dispose()
  })

  it('refuses an unknown attachment id with a copy-verbatim hint', async () => {
    const rec = recording([{ text: 'unused', model: 'm' }])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await ctx.plugin(VisionRuntime)
    ctx.vision.registerProvider(rec.provider)
    await ctx.plugin(ToolVision)

    let counter = 0
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(`att-miss-${++counter}`),
      name: 'view_image',
      arguments: { attachment_id: 'sha256:' + '0'.repeat(64) },
    })

    expect(result.isError).toBe(true)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('copied verbatim')
    await ctx.fiber.dispose()
  })

  it('refuses when both or neither source argument is given', () => {
    expect(() => parseViewImageArgs({})).toThrow('exactly one')
    expect(() => parseViewImageArgs({ file_path: 'a.png', attachment_id: 'x' })).toThrow('not both')
    expect(parseViewImageArgs({ attachment_id: ' x ' })).toEqual({ attachmentId: 'x' })
  })
})

describe('view_image composition', () => {
  it('never registers without a mounted attachment store', async () => {
    const { ctx } = await setup({ attachments: false })
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('view_image')
    expect(await promptText(ctx)).not.toContain('view_image tool')
  })

  it('unregisters the tool and prompt section when its fiber is disposed', async () => {
    const { ctx, fiber } = await setup({ provider: new RecordingProvider([{ text: 'x', model: 'm' }]) })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('view_image')
    expect(await promptText(ctx)).toContain('view_image tool')

    await fiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('view_image')
    expect(await promptText(ctx)).not.toContain('view_image tool')
  })

  it('fails loud for non-positive config budgets', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(VisionRuntime)
    await expect(ctx.plugin(ToolVision, { timeoutMs: 0 })).rejects.toThrow(/tool-vision: timeoutMs must be a positive integer/)
    await expect(ctx.plugin(ToolVision, { maxOutputChars: 1.5 })).rejects.toThrow(/tool-vision: maxOutputChars must be a positive integer/)
  })

  it('presents the call as a read-kind card with a location', async () => {
    const { ctx } = await setup({ provider: new RecordingProvider([]) })
    expect(ctx.tools.get('view_image')?.presentCall?.({ file_path: 'shot.png' })).toEqual({
      card: 'generic',
      title: 'View image shot.png',
      kind: 'read',
      locations: [{ path: 'shot.png' }],
    })
  })

  it('forwards a nested Code Mode description through the outer run_code context', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const { ctx } = await setup({ provider: new RecordingProvider([{ text: 'a red square', model: 'qwen2.5-vl' }]), toolMode: 'code' })
    const runtime = ctx.codeRuntime as FakeRuntime
    runtime.behavior = async (request) => {
      const value = await request.bindings[0]!.functions.view_image!({ file_path: 'red.png' })
      return { logs: [], value }
    }

    const result = await call(ctx, RUN_CODE_NAME, {
      code: 'return await tools.view_image({ file_path: "red.png" })',
      description: 'View the image through Code Mode',
    }, agentInDir())

    expect(result.isError).toBe(false)
    expect(result.additionalContexts).toHaveLength(1)
    const forwarded = result.additionalContexts?.[0]?.content
    expect(forwarded).toHaveLength(1)
    expect(forwarded?.[0]?.type).toBe('text')
    expect(forwarded?.[0]?.type === 'text' ? forwarded[0].text : '').toContain('<description>')
  })
})
