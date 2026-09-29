/** Config resolution: defaults fill and the chain reads the current config per call. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as qwenPlugin from '@deepseek-ai/dsh-vision-qwen'
import { resolveChain } from '@deepseek-ai/dsh-vision-qwen'

describe('vision config resolution', () => {
  it('resolves the backend chain from config with defaults', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    await ctx.plugin(qwenPlugin, {
      backends: [
        { id: 'chatgpt-luna', baseURL: 'https://gpt.test/v1', model: 'gpt-luna' },
        { id: 'qwen', baseURL: 'http://localhost:8080/v1', model: 'qwen-vl', enabled: false },
      ],
      attemptsPerBackend: 3,
    }).await()

    const chain = resolveChain(ctx, {
      backends: [
        { id: 'chatgpt-luna', baseURL: 'https://gpt.test/v1', model: 'gpt-luna' },
        { id: 'qwen', baseURL: 'http://localhost:8080/v1', model: 'qwen-vl', enabled: false },
      ],
      attemptsPerBackend: 3,
    })

    // Disabled backends leave the chain; the rest keep priority order.
    expect(chain.backends.map(entry => entry.id)).toEqual(['chatgpt-luna'])
    expect(chain.attemptsPerBackend).toBe(3)
    await ctx.fiber.dispose()
  })

  it('parks the provider when no backend is usable', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    await ctx.plugin(qwenPlugin, {}).await()

    await expect(ctx.vision.describe({ image: { bytes: new Uint8Array([1]), mediaType: 'image/png' } }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })
})
