import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VisionRuntime, {
  VisionError,
  type VisionDescribeRequest,
  type VisionDescription,
  type VisionProvider,
} from '@deepseek-ai/dsh-vision'

const image: VisionDescribeRequest['image'] = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }

/** A scripted vision provider for contract tests. */
function makeProvider(
  id: string,
  available: boolean,
  describe: (request: VisionDescribeRequest, signal?: AbortSignal) => Promise<VisionDescription>,
): VisionProvider {
  return { id, available: () => available, describe }
}

function description(marker: string): VisionDescription {
  return { text: `description from ${marker}`, model: `${marker}-model` }
}

/** Mount a VisionRuntime on a fresh root context with the given config. */
async function mountVision(config: ConstructorParameters<typeof VisionRuntime>[1] = {}): Promise<{ ctx: Context; vision: VisionRuntime }> {
  const ctx = new Context()
  await ctx.plugin(VisionRuntime, config)
  return { ctx, vision: ctx.vision }
}

describe('VisionRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { vision } = await mountVision()

    const dispose = vision.registerProvider(makeProvider('qwen', true, request => Promise.resolve(description(request.image.mediaType))))
    await expect(vision.describe({ image })).resolves.toMatchObject({ text: 'description from image/png' })

    dispose()
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('throws VISION_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { vision } = await mountVision()
    vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('first'))))
    expect(() => vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('second')))))
      .toThrow(expect.objectContaining({ code: 'VISION_DUPLICATE_PROVIDER' }))
  })

  it('unregisters providers when their registering plugin is disposed', async () => {
    const { ctx, vision } = await mountVision()
    const registrar = {
      name: 'vision-test-registrar',
      inject: ['vision'],
      apply: (inner: Context) => {
        inner.vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('qwen'))))
      },
    }
    const fiber = await ctx.plugin(registrar)
    await expect(vision.describe({ image })).resolves.toMatchObject({ model: 'qwen-model' })

    await fiber.dispose()
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })
})

describe('VisionRuntime provider selection', () => {
  it('uses the configured provider when registered and available', async () => {
    const { vision } = await mountVision({ provider: 'second' })
    vision.registerProvider(makeProvider('first', true, () => Promise.resolve(description('first'))))
    vision.registerProvider(makeProvider('second', true, () => Promise.resolve(description('second'))))
    await expect(vision.describe({ image })).resolves.toMatchObject({ model: 'second-model' })
  })

  it('rejects a configured id that is not registered', async () => {
    const { vision } = await mountVision({ provider: 'missing' })
    vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('qwen'))))
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('rejects a configured id that is registered but unavailable', async () => {
    const { vision } = await mountVision({ provider: 'qwen' })
    vision.registerProvider(makeProvider('qwen', false, () => Promise.resolve(description('qwen'))))
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('auto-selects the single usable provider', async () => {
    const { vision } = await mountVision()
    vision.registerProvider(makeProvider('dead', false, () => Promise.resolve(description('dead'))))
    vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('qwen'))))
    await expect(vision.describe({ image })).resolves.toMatchObject({ model: 'qwen-model' })
  })

  it('rejects auto-selection with no usable provider', async () => {
    const { vision } = await mountVision()
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
    vision.registerProvider(makeProvider('dead', false, () => Promise.resolve(description('dead'))))
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('rejects auto-selection across multiple usable providers', async () => {
    const { vision } = await mountVision()
    vision.registerProvider(makeProvider('first', true, () => Promise.resolve(description('first'))))
    vision.registerProvider(makeProvider('second', true, () => Promise.resolve(description('second'))))
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_AMBIGUOUS' }))
    await expect(vision.describe({ image })).rejects.toThrow(/first, second/)
  })
})

describe('VisionRuntime describe dispatch', () => {
  it('reports whether selection would succeed, without throwing', async () => {
    const { vision } = await mountVision()
    expect(vision.hasUsableProvider()).toBe(false)
    vision.registerProvider(makeProvider('dead', false, () => Promise.resolve(description('dead'))))
    expect(vision.hasUsableProvider()).toBe(false)
    vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('qwen'))))
    expect(vision.hasUsableProvider()).toBe(true)

    const pinned = await mountVision({ provider: 'dead' })
    pinned.vision.registerProvider(makeProvider('dead', false, () => Promise.resolve(description('dead'))))
    pinned.vision.registerProvider(makeProvider('qwen', true, () => Promise.resolve(description('qwen'))))
    expect(pinned.vision.hasUsableProvider()).toBe(false)
  })

  it('forwards the request and the cancellation signal to the selected provider', async () => {
    const { vision } = await mountVision()
    const controller = new AbortController()
    const seen: { prompt?: string | undefined; signal?: AbortSignal | undefined }[] = []
    vision.registerProvider(makeProvider('qwen', true, (request, signal) => {
      seen.push({ ...request.prompt !== undefined ? { prompt: request.prompt } : {}, signal })
      return Promise.resolve(description('qwen'))
    }))

    await vision.describe({ image })
    await vision.describe({ image, prompt: 'what color?' }, controller.signal)

    expect(seen[0]).toEqual({})
    expect(seen[1]?.prompt).toBe('what color?')
    expect(seen[1]?.signal).toBe(controller.signal)
  })

  it('propagates provider failures unchanged', async () => {
    const { vision } = await mountVision()
    vision.registerProvider(makeProvider('qwen', true, () => Promise.reject(new VisionError('backend down', 'VISION_PROVIDER_ERROR'))))
    await expect(vision.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })
})
