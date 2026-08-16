/** The `vision` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as qwenPlugin from '@deepseek-ai/dsh-vision-qwen'
import { VISION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-vision-qwen'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [String(ns)]: structuredClone(section) }
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A tiny valid PNG so describe inputs look like real image bytes. */
const IMAGE = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png' }

const ENTRY: qwenPlugin.Config = {
  backends: [
    { id: 'entry-model', baseURL: 'https://entry.test/v1', model: 'entry-model-id' },
  ],
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(VisionRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(qwenPlugin, structuredClone(ENTRY))
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Run one describe and answer the endpoint it reached. A fresh `Response` per
 * call because a body can only be read once, and the call history is cleared
 * because repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.vision` serves the describe.
 * @returns the URL the provider fetched.
 */
async function describeOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }] })))
  fetchSpy.mockClear()
  await ctx.vision.describe({ image: IMAGE })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

describe('vision settings section', () => {
  it('serves a stored backend to the next describe without re-registering the provider', async () => {
    const bench = await boot()
    expect(await describeOnce(bench.ctx)).toContain('https://entry.test/v1')

    await bench.ctx.settings.update(VISION_SETTINGS_NAMESPACE, {
      backends: [{ id: 'stored', baseURL: 'https://stored.test/v1', model: 'stored-model' }],
    })

    expect(await describeOnce(bench.ctx)).toContain('https://stored.test/v1')
    await bench.ctx.fiber.dispose()
  })

  it('parks the provider when the stored section empties the chain', async () => {
    const bench = await boot()
    expect(await describeOnce(bench.ctx)).toContain('https://entry.test/v1')

    await bench.ctx.settings.update(VISION_SETTINGS_NAMESPACE, { backends: [] })

    await expect(bench.ctx.vision.describe({ image: IMAGE }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(VISION_SETTINGS_NAMESPACE, {
      backends: [{ id: 'secret', baseURL: 'https://s.test/v1', model: 'm', apiKey: 'qwen-stored-secret' }],
    })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'vision')

    expect(JSON.stringify(descriptor)).not.toContain('qwen-stored-secret')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(VISION_SETTINGS_NAMESPACE, {
      backends: [{ id: 'stored', baseURL: 'https://stored.test/v1', model: 'stored-model' }],
    })
    expect(await describeOnce(bench.ctx)).toContain('https://stored.test/v1')

    await bench.settingsFiber.dispose()

    expect(await describeOnce(bench.ctx)).toContain('https://entry.test/v1')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('vision')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('vision')
    await bench.ctx.fiber.dispose()
  })
})
