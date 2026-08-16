import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as qwenPlugin from '@deepseek-ai/dsh-vision-qwen'
import {
  QwenVisionProvider,
  QWEN_DEFAULT_INSTRUCTION,
  VISION_CHAIN_PROVIDER_ID,
  qwenContentText,
} from '@deepseek-ai/dsh-vision-qwen'
import type { VisionBackendOptions, VisionChainOptions } from '@deepseek-ai/dsh-vision-qwen'

/** One backend with static facts. */
function backend(overrides: Partial<VisionBackendOptions> = {}): VisionBackendOptions {
  return {
    id: 'qwen',
    model: 'qwen2.5-vl-7b-instruct',
    baseURL: 'https://qwen.test/v1',
    resolveApiKey: async () => 'qwen-key',
    instruction: QWEN_DEFAULT_INSTRUCTION,
    ...overrides,
  }
}

/** A chain over static facts — the plugin's per-call resolution has its own tests below. */
function chain(backends: readonly VisionBackendOptions[], overrides: Partial<VisionChainOptions> = {}): VisionChainOptions {
  return {
    backends,
    attemptsPerBackend: 2,
    temperature: 0.2,
    maxTokens: 1024,
    timeoutMs: 60_000,
    ...overrides,
  }
}

/** A tiny valid PNG so describe inputs look like real image bytes. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const image = { bytes: PNG_BYTES, mediaType: 'image/png' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.QWEN_API_KEY
})

describe('qwenContentText', () => {
  it('passes a plain string through', () => {
    expect(qwenContentText('a description')).toBe('a description')
  })

  it('joins the text parts of a content-parts array and drops the rest', () => {
    expect(qwenContentText([
      { type: 'text', text: 'first' },
      { type: 'image_url', image_url: { url: 'data:…' } },
      { type: 'text', text: 'second' },
      { type: 'text', text: 42 },
      'bare string',
      null,
    ])).toBe('first\nsecond')
  })

  it('returns an empty string for unusable content', () => {
    expect(qwenContentText(undefined)).toBe('')
    expect(qwenContentText(42)).toBe('')
    expect(qwenContentText({})).toBe('')
    expect(qwenContentText([])).toBe('')
  })
})

describe('chain availability', () => {
  it('is available when any backend is configured', () => {
    expect(new QwenVisionProvider(() => chain([backend()])).available()).toBe(true)
  })

  it('parks when no backend is usable', () => {
    expect(new QwenVisionProvider(() => chain([])).available()).toBe(false)
    expect(new QwenVisionProvider(() => chain([backend({ model: '' })])).available()).toBe(false)
    expect(new QwenVisionProvider(() => chain([backend({ baseURL: 'not a url' })])).available()).toBe(false)
  })

  it('registers under one chain id', () => {
    expect(new QwenVisionProvider(() => chain([])).id).toBe(VISION_CHAIN_PROVIDER_ID)
  })
})

describe('chain describe wire contract', () => {
  it('sends the documented chat-completions request with a base64 data URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ model: 'served-model', choices: [{ message: { content: 'a red square' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([backend()])).describe({ image })

    expect(description).toEqual({ text: 'a red square', model: 'served-model' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://qwen.test/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer qwen-key')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('qwen2.5-vl-7b-instruct')
    expect(body.stream).toBe(false)
    expect(body.max_tokens).toBe(1024)
    expect(body.temperature).toBe(0.2)
    const messages = body.messages as { role: string; content: unknown }[]
    expect(messages[0]).toEqual({ role: 'system', content: QWEN_DEFAULT_INSTRUCTION })
    const parts = messages[1]?.content as { type: string; text?: string; image_url?: { url: string } }[]
    expect(parts[0]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`)
    expect(parts[1]).toEqual({ type: 'text', text: 'Describe this image in detail.' })
  })

  it('carries the focus prompt and omits the Authorization header for a keyless backend', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'mostly blue' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([backend({ resolveApiKey: async () => '' })]))
      .describe({ image, prompt: 'what dominates?' })

    expect(description.text).toBe('mostly blue')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
    const body = JSON.parse(init.body as string) as { messages: { content: { type: string; text?: string }[] }[] }
    expect(body.messages[1]?.content[1]).toEqual({ type: 'text', text: 'what dominates?' })
  })

  it('reads its facts per call, so a resolution change reaches the next describe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    let model = 'first-model'
    const dynamic = new QwenVisionProvider(() => chain([backend({ model })]))

    await dynamic.describe({ image })
    model = 'second-model'
    await dynamic.describe({ image })

    const bodies = fetchMock.mock.calls
      .map(call => JSON.parse(((call as unknown[])[1] as RequestInit).body as string) as { model: string })
      .map(parsed => parsed.model)
    expect(bodies).toEqual(['first-model', 'second-model'])
  })

  it('falls back to a reasoning field when content comes back empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '', reasoning_content: 'the answer only reasoning carried' } }],
    })))
    await expect(new QwenVisionProvider(() => chain([backend()])).describe({ image }))
      .resolves.toMatchObject({ text: 'the answer only reasoning carried' })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { reasoning: 'gateway-style reasoning field' } }],
    })))
    await expect(new QwenVisionProvider(() => chain([backend()])).describe({ image }))
      .resolves.toMatchObject({ text: 'gateway-style reasoning field' })
  })
})

describe('chain priority and fallback', () => {
  /** Counting mock: backend "primary" always 500s, backend "fallback" answers. */
  function twoBackendMock(): { calls: string[]; mock: ReturnType<typeof vi.fn> } {
    const calls: string[] = []
    const mock = vi.fn(async (url: string) => {
      const target = url
      calls.push(target.includes('://fallback.') ? 'fallback' : 'primary')
      if (target.includes('://fallback.')) return jsonResponse({ choices: [{ message: { content: 'from fallback' } }] })
      return jsonResponse({ error: 'primary down' }, { status: 500 })
    })
    vi.stubGlobal('fetch', mock)
    return { calls, mock }
  }

  it('serves from the first priority without touching lower ones', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('://fallback.')) throw new Error('fallback must not be called')
      return jsonResponse({ choices: [{ message: { content: 'from primary' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ])).describe({ image })

    expect(description.text).toBe('from primary')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('exhausts the attempt budget before falling to the next priority', async () => {
    const { calls } = twoBackendMock()

    const description = await new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ])).describe({ image })

    expect(description.text).toBe('from fallback')
    expect(calls).toEqual(['primary', 'primary', 'fallback'])
  })

  it('honors a larger attempt budget before falling', async () => {
    const { calls } = twoBackendMock()

    await new QwenVisionProvider(() => chain(
      [backend({ id: 'primary', baseURL: 'https://primary.test/v1' }), backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' })],
      { attemptsPerBackend: 3 },
    )).describe({ image })

    expect(calls).toEqual(['primary', 'primary', 'primary', 'fallback'])
  })

  it('lists every failed attempt when the whole chain fails', async () => {
    const { calls } = twoBackendMock()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'down' }, { status: 503 })))

    await expect(new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ])).describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
    await expect(new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ])).describe({ image })).rejects.toThrow(/primary \(attempt 1\/2\)[\s\S]*fallback \(attempt 2\/2\)/)
    expect(calls).toHaveLength(0)
  })

  it('reports a transport failure with its underlying cause code', async () => {
    const transportError = new TypeError('fetch failed')
    ;(transportError as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw transportError }))

    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/ECONNREFUSED/)
  })

  it('does not fall through a caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
      const signal = init?.signal ?? new AbortController().signal
      return new Promise((_resolve, reject) => {
        const abort = () => { reject(new DOMException('aborted', 'AbortError')) }
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort)
      })
    }))

    await expect(new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ], { attemptsPerBackend: 1 })).describe({ image }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('maps its own deadline firing to VISION_ABORTED and falls to the next backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const signal = init?.signal ?? new AbortController().signal
      if (url.includes('://fallback.')) return jsonResponse({ choices: [{ message: { content: 'from fallback' } }] })
      return new Promise((_resolve, reject) => {
        const abort = () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort)
      })
    }))

    const description = await new QwenVisionProvider(() => chain([
      backend({ id: 'primary', baseURL: 'https://primary.test/v1' }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ], { attemptsPerBackend: 1, timeoutMs: 20 })).describe({ image })

    expect(description.text).toBe('from fallback')
  }, 10_000)
})

describe('vision-qwen plugin', () => {
  it('serves a backends chain from the composition entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('://gpt.')) return jsonResponse({ choices: [{ message: { content: 'from gpt' } }] })
      throw new Error('primary must answer first')
    }))
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    await ctx.plugin(qwenPlugin, {
      backends: [
        { id: 'gpt-luna', baseURL: 'https://gpt.test/v1', model: 'gpt-luna' },
      ],
    }).await()

    await expect(ctx.vision.describe({ image })).resolves.toMatchObject({ text: 'from gpt' })
    await ctx.fiber.dispose()
  })

  it('parks instead of failing the load when no backend is configured', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    await ctx.plugin(qwenPlugin, {}).await()

    await expect(ctx.vision.describe({ image }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })

  it('caps the composed chain at five backends and drops disabled ones', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    await ctx.plugin(qwenPlugin, {
      backends: [
        { id: 'disabled-one', baseURL: 'https://a.test/v1', model: 'm', enabled: false },
        ...[1, 2, 3, 4, 5, 6].map(n => ({ id: `b${n}`, baseURL: `https://b${n}.test/v1`, model: `m${n}` })),
      ],
    }).await()

    const resolved = qwenPlugin.resolveChain(ctx, { backends: [
      { id: 'disabled-one', baseURL: 'https://a.test/v1', model: 'm', enabled: false },
      ...[1, 2, 3, 4, 5, 6].map(n => ({ id: `b${n}`, baseURL: `https://b${n}.test/v1`, model: `m${n}` })),
    ] })
    // The cap bounds the stored chain (the card's row limit): a disabled
    // entry inside the first five still consumes its slot.
    expect(resolved.backends.map(entry => entry.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
    await ctx.fiber.dispose()
  })

  it('resolves per-backend credential references and literals', async () => {
    const seen: (string | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.authorization)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    }))
    process.env.VISION_ENVKEY_API_KEY = 'ambient-key'
    try {
      const ctx = new Context()
      await ctx.plugin(VisionRuntime)
      await ctx.plugin(qwenPlugin, {
        backends: [
          { id: 'envkey', baseURL: 'https://env.test/v1', model: 'm' },
          { id: 'litkey', baseURL: 'https://lit.test/v1', model: 'm', apiKey: 'literal-key' },
        ],
      }).await()

      const describeLit = ctx.vision.describe({ image })
      // envkey has priority 1; make it fail so litkey answers with its literal.
      // (fetch mock answers ok for both — instead assert resolution directly.)
      await describeLit
      expect(seen.at(-1)).toBe('Bearer ambient-key')

      const resolved = qwenPlugin.resolveChain(ctx, {
        backends: [{ id: 'litkey', baseURL: 'https://lit.test/v1', model: 'm', apiKey: 'literal-key' }],
      })
      expect(await resolved.backends[0]?.resolveApiKey()).toBe('literal-key')
      await ctx.fiber.dispose()
    } finally {
      delete process.env.VISION_ENVKEY_API_KEY
    }
  })
})
