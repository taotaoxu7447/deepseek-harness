/**
 * Real Loader-path guard for an injected namespace plugin. A default export would make
 * `unwrapExports` collapse the namespace and drop `inject`, causing access to `ctx.vision` to fail.
 * Hand-built mounting bypasses that path, so this test unwraps through the real Loader first; see
 * postmortem 0001.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as toolVision from '@deepseek-ai/dsh-tool-vision'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-tool-vision-load-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('dsh-tool-vision real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolVision).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolVision) as Record<string, unknown>
    expect(unwrapped).toBe(toolVision)
    expect(unwrapped.name).toBe('tool-vision')
    expect(unwrapped.inject).toEqual(['tools', 'vision', 'fs', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over its seams through the unwrapped module without an inject error', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await ctx.plugin(VisionRuntime)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolVision) as Parameters<Context['plugin']>[0]
    // Mounting the collapsed shape would throw for missing injection here.
    const fiber = await ctx.plugin(unwrapped)
    expect(ctx.tools.schemas().map(s => s.name)).toContain('view_image')
    await fiber.dispose()
  })
})
