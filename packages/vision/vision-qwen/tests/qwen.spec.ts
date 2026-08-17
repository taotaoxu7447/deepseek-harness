import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as qwenPlugin from '@deepseek-ai/dsh-vision-qwen'
import {
  anthropicEffortFragment,
  chatEffortFragment,
  estimateInputTokens,
  QwenVisionProvider,
  QWEN_DEFAULT_INSTRUCTION,
  resolveChain,
  responsesEffortFragment,
  validateVisionConfig,
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
    protocol: 'openai-chat',
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

describe('responses protocol wire contract', () => {
  it('sends the documented Responses request with effort and no temperature', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ model: 'srv-mimo', output_text: 'a flowchart' }))
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([
      backend({ protocol: 'openai-responses', effortPreset: 'openai', effortLevel: 'high' }),
    ])).describe({ image })

    expect(description).toEqual({ text: 'a flowchart', model: 'srv-mimo' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://qwen.test/v1/responses')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer qwen-key')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('qwen2.5-vl-7b-instruct')
    expect(body.instructions).toBe(QWEN_DEFAULT_INSTRUCTION)
    expect(body.max_output_tokens).toBe(1024)
    expect(body.stream).toBe(false)
    expect('temperature' in body).toBe(false)
    expect(body.reasoning).toEqual({ effort: 'high' })
    const input = body.input as { content: { type: string; image_url?: string; text?: string }[] }[]
    expect(input[0]?.content[0]).toEqual({
      type: 'input_image',
      image_url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`,
    })
    expect(input[0]?.content[1]).toEqual({ type: 'input_text', text: 'Describe this image in detail.' })
  })

  it('walks the output items when output_text is absent and falls back to the configured model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'walked text' }] },
      ],
    })))

    const description = await new QwenVisionProvider(() => chain([
      backend({ protocol: 'openai-responses' }),
    ])).describe({ image })

    expect(description).toEqual({ text: 'walked text', model: 'qwen2.5-vl-7b-instruct' })
  })

  it('rejects a reply carrying no text on either Responses shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ output: [{ type: 'message', content: [] }] })))

    await expect(new QwenVisionProvider(() => chain(
      [backend({ protocol: 'openai-responses' })],
      { attemptsPerBackend: 1 },
    )).describe({ image }))
      .rejects.toThrow(/returned no description text/)
  })
})

describe('anthropic protocol wire contract', () => {
  it('sends the documented Messages request with thinking and both auth headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      model: 'claude-vision',
      content: [{ type: 'thinking', thinking: 'considering' }, { type: 'text', text: 'an architecture diagram' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([
      backend({ baseURL: 'https://anthropic.test', protocol: 'anthropic', effortPreset: 'anthropic', effortEnabled: true, thinkingBudget: 2048 }),
    ])).describe({ image })

    expect(description).toEqual({ text: 'an architecture diagram', model: 'claude-vision' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://anthropic.test/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('qwen-key')
    expect(headers.authorization).toBe('Bearer qwen-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.system).toBe(QWEN_DEFAULT_INSTRUCTION)
    expect(body.max_tokens).toBe(1024)
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
    // Extended thinking rejects non-default sampling.
    expect('temperature' in body).toBe(false)
    const messages = body.messages as { content: Record<string, unknown>[] }[]
    expect(messages[0]?.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') },
    })
    expect(messages[0]?.content[1]).toEqual({ type: 'text', text: 'Describe this image in detail.' })
  })

  it('sends temperature and no thinking when the effort toggle stands off', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ content: 'plain string content' }))
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([
      backend({ protocol: 'anthropic', resolveApiKey: async () => '' }),
    ])).describe({ image })

    expect(description.text).toBe('plain string content')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // A keyless endpoint sends no auth headers; the version header is protocol, not auth.
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.temperature).toBe(0.2)
    expect('thinking' in body).toBe(false)
  })

  it('surfaces an Anthropic error body message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      { status: 401 },
    )))

    await expect(new QwenVisionProvider(() => chain(
      [backend({ protocol: 'anthropic' })],
      { attemptsPerBackend: 1 },
    )).describe({ image }))
      .rejects.toThrow(/invalid x-api-key/)
  })
})

describe('effort fragments', () => {
  it('maps the openai preset onto chat and responses', () => {
    expect(chatEffortFragment({ effortPreset: 'openai', effortLevel: 'minimal' })).toEqual({ reasoning_effort: 'minimal' })
    expect(responsesEffortFragment({ effortPreset: 'openai', effortLevel: 'none' })).toEqual({ reasoning: { effort: 'none' } })
    expect(chatEffortFragment({ effortPreset: 'openai' })).toEqual({})
    expect(responsesEffortFragment({ effortPreset: 'openai' })).toEqual({})
  })

  it('maps the mimo toggle onto none/low only', () => {
    expect(chatEffortFragment({ effortPreset: 'mimo', effortEnabled: true })).toEqual({ reasoning_effort: 'low' })
    expect(chatEffortFragment({ effortPreset: 'mimo', effortEnabled: false })).toEqual({ reasoning_effort: 'none' })
    expect(chatEffortFragment({ effortPreset: 'mimo' })).toEqual({})
    expect(responsesEffortFragment({ effortPreset: 'mimo', effortEnabled: true })).toEqual({ reasoning: { effort: 'low' } })
    expect(responsesEffortFragment({ effortPreset: 'mimo', effortEnabled: false })).toEqual({ reasoning: { effort: 'none' } })
    expect(responsesEffortFragment({ effortPreset: 'mimo' })).toEqual({})
  })

  it('maps the qwen-local toggle onto chat_template_kwargs and nothing else', () => {
    expect(chatEffortFragment({ effortPreset: 'qwen-local', effortEnabled: true, thinkingBudget: 512 }))
      .toEqual({ chat_template_kwargs: { enable_thinking: true, thinking_budget: 512 } })
    expect(chatEffortFragment({ effortPreset: 'qwen-local', effortEnabled: true }))
      .toEqual({ chat_template_kwargs: { enable_thinking: true } })
    expect(chatEffortFragment({ effortPreset: 'qwen-local', effortEnabled: false, thinkingBudget: 512 }))
      .toEqual({ chat_template_kwargs: { enable_thinking: false } })
    expect(chatEffortFragment({ effortPreset: 'qwen-local' })).toEqual({})
    expect(responsesEffortFragment({ effortPreset: 'qwen-local', effortEnabled: true })).toEqual({})
    expect(anthropicEffortFragment({ effortPreset: 'qwen-local', effortEnabled: true })).toEqual({})
  })

  it('maps the anthropic toggle onto a thinking budget and nothing else', () => {
    expect(anthropicEffortFragment({ effortPreset: 'anthropic', effortEnabled: true, thinkingBudget: 4096 }))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } })
    expect(anthropicEffortFragment({ effortPreset: 'anthropic', effortEnabled: false })).toEqual({})
    expect(anthropicEffortFragment({ effortPreset: 'anthropic' })).toEqual({})
    expect(chatEffortFragment({ effortPreset: 'anthropic', effortEnabled: true, thinkingBudget: 4096 })).toEqual({})
  })

  it('sends nothing without a preset', () => {
    expect(chatEffortFragment({})).toEqual({})
    expect(responsesEffortFragment({})).toEqual({})
    expect(anthropicEffortFragment({})).toEqual({})
  })
})

describe('input guard', () => {
  /** A 600×400 PNG (real IHDR) so the pixel term of the estimate applies. */
  const SIZED_PNG = (() => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    bytes.set([0, 0, 0x02, 0x58], 16)
    bytes.set([0, 0, 0x01, 0x90], 20)
    return bytes
  })()

  it('estimates text plus probed pixels, falling back to bytes when the header is unreadable', () => {
    // 600×400 / 750 pixels-per-token = 320 image tokens; text adds its chars/4.
    expect(estimateInputTokens('', '', { bytes: SIZED_PNG, mediaType: 'image/png' })).toBe(320)
    expect(estimateInputTokens('abcd', 'efgh', { bytes: SIZED_PNG, mediaType: 'image/png' })).toBe(322)
    // The 8-byte fixture PNG has no readable header: 8/4 = 2 image tokens.
    expect(estimateInputTokens('', '', image)).toBe(2)
  })

  it('refuses an over-limit describe before any request leaves', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'unreachable' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    // The chain summary wraps the refusal; the per-backend code is asserted below.
    await expect(new QwenVisionProvider(() => chain(
      [backend({ maxInputTokens: 1 })],
      { attemptsPerBackend: 1 },
    )).describe({ image }))
      .rejects.toThrow(/estimated input of \d+ tokens exceeds its configured limit of 1/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends an under-limit describe and names the estimate in the refusal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'fits' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new QwenVisionProvider(() => chain([
      backend({ maxInputTokens: 100_000 }),
    ])).describe({ image })).resolves.toMatchObject({ text: 'fits' })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'unused' } }] })))
    await expect(new QwenVisionProvider(() => chain(
      [backend({ maxInputTokens: 10 })],
      { attemptsPerBackend: 1 },
    )).describe({ image }))
      .rejects.toThrow(/estimated input of \d+ tokens exceeds its configured limit of 10/)
  })

  it('skips the remaining attempts of a refused backend but still falls to the next priority', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('://fallback.')) return jsonResponse({ choices: [{ message: { content: 'from fallback' } }] })
      throw new Error('the refused backend must never be fetched')
    })
    vi.stubGlobal('fetch', fetchMock)

    const description = await new QwenVisionProvider(() => chain([
      backend({ id: 'limited', baseURL: 'https://limited.test/v1', maxInputTokens: 1 }),
      backend({ id: 'fallback', baseURL: 'https://fallback.test/v1' }),
    ], { attemptsPerBackend: 3 })).describe({ image })

    expect(description.text).toBe('from fallback')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('carries the refusal into the all-failed summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('never fetched') }))

    await expect(new QwenVisionProvider(() => chain(
      [backend({ id: 'limited', baseURL: 'https://limited.test/v1', maxInputTokens: 1 })],
      { attemptsPerBackend: 2 },
    )).describe({ image }))
      .rejects.toThrow(/limited \(attempt 1\/2\):.*exceeds its configured limit/)
  })
})

describe('validateVisionConfig', () => {
  /** Wrap one config in a thunk so expect(...).toThrow reads without a void-returning arrow. */
  const check = (config: Parameters<typeof validateVisionConfig>[0]) => () => { validateVisionConfig(config) }

  it('rejects a completion budget over the context window', () => {
    expect(check({ backends: [{ id: 'b', contextTokens: 512 }] })).toThrow(/maxTokens 1024 exceeds/)
    expect(check({ maxTokens: 512, backends: [{ id: 'b', contextTokens: 512 }] })).not.toThrow()
    expect(check({ backends: [{ id: 'b' }] })).not.toThrow()
    expect(check({})).not.toThrow()
  })

  it('rejects effort fields without their preset', () => {
    expect(check({ backends: [{ id: 'b', effortLevel: 'high' }] })).toThrow(/effortLevel requires effortPreset "openai"/)
    expect(check({ backends: [{ id: 'b', effortPreset: 'openai', effortLevel: 'high' }] })).not.toThrow()
    expect(check({ backends: [{ id: 'b', effortPreset: 'openai', effortEnabled: true }] })).toThrow(/effortEnabled requires/)
    expect(check({ backends: [{ id: 'b', effortEnabled: true }] })).toThrow(/effortEnabled requires/)
    expect(check({ backends: [{ id: 'b', effortPreset: 'mimo', effortEnabled: true }] })).not.toThrow()
    expect(check({ backends: [{ id: 'b', effortPreset: 'openai', thinkingBudget: 2048 }] })).toThrow(/thinkingBudget requires/)
    expect(check({ backends: [{ id: 'b', effortPreset: 'qwen-local', thinkingBudget: 2048 }] })).not.toThrow()
  })

  it('rejects a preset its protocol cannot carry', () => {
    expect(check({ backends: [{ id: 'b', protocol: 'anthropic', effortPreset: 'openai' }] }))
      .toThrow(/effortPreset "openai" does not apply to protocol "anthropic"/)
    expect(check({ backends: [{ id: 'b', protocol: 'openai-responses', effortPreset: 'qwen-local' }] }))
      .toThrow(/effortPreset "qwen-local" does not apply/)
    // qwen-local defaults to the chat protocol, the only one carrying chat_template_kwargs.
    expect(check({ backends: [{ id: 'b', effortPreset: 'qwen-local' }] })).not.toThrow()
    expect(check({ backends: [{ id: 'b', protocol: 'anthropic', effortPreset: 'anthropic' }] })).not.toThrow()
    expect(check({ backends: [{ id: 'b', protocol: 'openai-responses', effortPreset: 'mimo', effortEnabled: false }] })).not.toThrow()
  })

  it('rejects an anthropic thinking toggle without a valid budget', () => {
    const anthropic = { id: 'b', protocol: 'anthropic' as const, effortPreset: 'anthropic' as const, effortEnabled: true }
    expect(check({ maxTokens: 4096, backends: [{ ...anthropic }] })).toThrow(/requires thinkingBudget/)
    expect(check({ maxTokens: 4096, backends: [{ ...anthropic, thinkingBudget: 512 }] })).toThrow(/at least 1024/)
    expect(check({ maxTokens: 4096, backends: [{ ...anthropic, thinkingBudget: 4096 }] })).toThrow(/must stay below maxTokens/)
    expect(check({ maxTokens: 4096, backends: [{ ...anthropic, thinkingBudget: 2048 }] })).not.toThrow()
  })

  it('fails the composition load on an invalid entry', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime)
    const fiber = ctx.plugin(qwenPlugin, {
      backends: [{ id: 'bad', effortLevel: 'high' }],
    })
    // Terminate the fiber handle too: a failing plugin lands there as an
    // unhandled rejection unless something reads it.
    void Promise.resolve(fiber).catch(() => {})
    await expect(fiber.await()).rejects.toThrow(/effortLevel requires/)
    await ctx.fiber.dispose()
  })
})

describe('resolveChain', () => {
  it('defaults every unset backend field and answers keys from the ambient environment', async () => {
    const ctx = new Context()
    const [entry] = resolveChain(ctx, { backends: [{ id: 'sparse' }] }).backends
    expect(entry?.model).toBe('')
    expect(entry?.baseURL).toBe('')
    expect(entry?.protocol).toBe('openai-chat')
    expect(entry).not.toHaveProperty('effortPreset')

    process.env.VISION_SPARSE_API_KEY = 'ambient-key'
    await expect(entry?.resolveApiKey() ?? Promise.resolve('missing')).resolves.toBe('ambient-key')
    delete process.env.VISION_SPARSE_API_KEY
    await expect(entry?.resolveApiKey() ?? Promise.resolve('missing')).resolves.toBe('')
    await ctx.fiber.dispose()
  })

  it('honors the QWEN_BASE_URL fallback and carries the effort and limit fields', () => {
    const ctx = new Context()
    process.env.QWEN_BASE_URL = 'https://env-qwen.test/v1'
    const [openai, local] = resolveChain(ctx, {
      backends: [
        { id: 'a', effortPreset: 'openai', effortLevel: 'high' },
        { id: 'b', effortPreset: 'qwen-local', effortEnabled: true, thinkingBudget: 2048, maxInputTokens: 5000 },
      ],
    }).backends
    delete process.env.QWEN_BASE_URL

    expect(openai?.baseURL).toBe('https://env-qwen.test/v1')
    expect(openai).toMatchObject({ effortPreset: 'openai', effortLevel: 'high' })
    expect(local).toMatchObject({ effortPreset: 'qwen-local', effortEnabled: true, thinkingBudget: 2048, maxInputTokens: 5000 })
    return ctx.fiber.dispose()
  })

  it('prefers a literal key and the credentials seam over the ambient environment', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: (ref: string) => Promise.resolve(ref === 'VISION_EMPTY_API_KEY' ? undefined : { value: `seam:${ref}` }),
    } as never)
    const [literal, seam, empty] = resolveChain(ctx, {
      backends: [{ id: 'lit', apiKey: 'literal-key' }, { id: 'seam' }, { id: 'empty' }],
    }).backends

    await expect(literal?.resolveApiKey() ?? Promise.resolve('missing')).resolves.toBe('literal-key')
    await expect(seam?.resolveApiKey() ?? Promise.resolve('missing')).resolves.toBe('seam:VISION_SEAM_API_KEY')
    await expect(empty?.resolveApiKey() ?? Promise.resolve('missing')).resolves.toBe('')
    await ctx.fiber.dispose()
  })

  it('resolves an empty section to an empty chain', () => {
    const ctx = new Context()
    expect(resolveChain(ctx, {}).backends).toEqual([])
    return ctx.fiber.dispose()
  })
})

describe('wire edge cases', () => {
  it('reads no text from malformed chat-completion message shapes', async () => {
    for (const payload of [
      { choices: 'not-an-array' },
      { choices: [42] },
      { choices: [{ message: 'not-an-object' }] },
      { choices: [{ message: {} }] },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)))
      await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
        .rejects.toThrow(/no description text/)
      vi.unstubAllGlobals()
    }
  })

  it('reads no text from a responses reply with no usable part anywhere', async () => {
    const responses = () => backend({ protocol: 'openai-responses' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(new QwenVisionProvider(() => chain([responses()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/no description text/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      output: [
        'junk',
        { type: 'reasoning' },
        { type: 'message', content: ['junk', { type: 'output_text' }, { type: 'output_text', text: 42 }] },
      ],
    })))
    await expect(new QwenVisionProvider(() => chain([responses()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/no description text/)
  })

  it('keeps the HTTP status when an error body carries no usable detail', async () => {
    for (const [body, pattern] of [
      [{ error: '' }, /HTTP 500/],
      [{ error: {} }, /HTTP 500/],
      [{ error: null }, /HTTP 500/],
      [{ message: 'quota exhausted' }, /quota exhausted/],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, { status: 500 })))
      await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
        .rejects.toThrow(pattern)
      vi.unstubAllGlobals()
    }
  })

  it('keeps the HTTP status when the error body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway timeout', { status: 502 })))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/HTTP 502/)
  })

  it('aborts the describe when the caller cancels while a backend fails', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 }))
      .describe({ image }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('treats an abort raised while reading a body as cancellation of that read', async () => {
    const aborted = {
      ok: false,
      status: 500,
      json: () => Promise.reject(new DOMException('read aborted', 'AbortError')),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => aborted))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/vision request aborted/)

    const abortedOk = {
      ok: true,
      json: () => Promise.reject(new DOMException('read aborted', 'AbortError')),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => abortedOk))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/vision request aborted/)
  })

  it('fails a success body that does not parse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/unprocessable response body/)
  })

  it('fails fast when no backend is usable', async () => {
    await expect(new QwenVisionProvider(() => chain([backend({ model: '' })])).describe({ image }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('stringifies a backend failure that is not an Error', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test.
    const keyless = backend({ resolveApiKey: () => Promise.reject('key store locked') })
    await expect(new QwenVisionProvider(() => chain([keyless], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/key store locked/)
  })

  it('names the bare transport error when no cause code rides it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(new QwenVisionProvider(() => chain([backend()], { attemptsPerBackend: 1 })).describe({ image }))
      .rejects.toThrow(/request failed: TypeError: fetch failed$/)
  })
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
