/**
 * The vision chain provider: every configured backend in priority order, with
 * per-backend attempt budgets and fallback. One backend's failure after its
 * budget falls to the next priority; caller cancellation never falls through.
 * The HTTP shape per backend is the OpenAI-compatible `/chat/completions`
 * wire (local vLLM/SGLang/llama.cpp Qwen VL, ChatGPT Luna, or any other
 * server speaking it); the image rides the request as a base64 data URL.
 *
 * Options resolve per call from a thunk, so a settings-section change reaches
 * the very next describe without re-registering the provider.
 * @module @deepseek-ai/dsh-vision-qwen/provider
 */

import { Buffer } from 'node:buffer'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { VisionError } from '@deepseek-ai/dsh-vision'
import type { VisionDescription, VisionProvider } from '@deepseek-ai/dsh-vision'

/** Registry id the chain registers under. */
export const VISION_CHAIN_PROVIDER_ID = 'vision'

/** Default credential reference; the web Vision card writes its literal through the credentials domain. */
export const QWEN_DEFAULT_API_KEY_ENV = 'QWEN_API_KEY'

/** Environment variable naming the endpoint base. */
export const QWEN_BASE_URL_ENV = 'QWEN_BASE_URL'

/** Default sampling temperature: low, because a description must stay factual. */
export const QWEN_DEFAULT_TEMPERATURE = 0.2

/** Default completion budget (tokens) for one description. */
export const QWEN_DEFAULT_MAX_TOKENS = 1024

/** Default HTTP budget (ms) for one describe attempt. */
export const QWEN_DEFAULT_TIMEOUT_MS = 60_000

/** Default attempts one backend gets before the chain falls to the next priority. */
export const QWEN_DEFAULT_ATTEMPTS_PER_BACKEND = 2

/** Default sampling instruction; each backend config may override. */
export const QWEN_DEFAULT_INSTRUCTION = [
  'You are the vision subsystem of a coding agent. Describe the image factually and completely.',
  'Cover the overall content, the main objects and their arrangement, and any text in the image transcribed exactly as it appears.',
  'Include details relevant to software work when present: UI elements, charts, error messages, and code on screen.',
  'Do not speculate beyond what is visible; state uncertainty explicitly.',
].join(' ')

/** User-turn text when a request carries no focus prompt. */
export const QWEN_DEFAULT_ASK = 'Describe this image in detail.'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** One resolved backend for a describe call (the plugin's `apply` builds each from the section). */
export interface VisionBackendOptions {
  /** Stable id naming this backend in errors and credential references. */
  id: string
  /** Vision model id the endpoint serves; empty = not configured. */
  model: string
  /** Endpoint base; `/chat/completions` is appended; empty = not configured. */
  baseURL: string
  /**
   * Resolve the API key for an attempt; an empty string sends no
   * `Authorization` header (a keyless local endpoint).
   */
  resolveApiKey: () => Promise<string>
  /** System instruction for this backend's describe calls. */
  instruction: string
}

/** Resolved chain facts for one describe call. */
export interface VisionChainOptions {
  /** Backends in priority order (index 0 first). */
  backends: readonly VisionBackendOptions[]
  /** Attempts each backend gets before the chain falls to the next priority. */
  attemptsPerBackend: number
  /** Sampling temperature for every backend. */
  temperature: number
  /** Completion budget (tokens) for one description. */
  maxTokens: number
  /** HTTP budget (ms) for one describe attempt. */
  timeoutMs: number
}

/** A chat-completions response content part, after JSON parsing. */
interface QwenContentPart {
  readonly type?: unknown
  readonly text?: unknown
}

/** A chat-completions response message, after JSON parsing. */
interface QwenResponseMessage {
  readonly content?: unknown
  readonly reasoning_content?: unknown
  readonly reasoning?: unknown
}

/** A chat-completions response, after JSON parsing. */
interface QwenChatResponse {
  readonly model?: unknown
  readonly choices?: unknown
}

/**
 * Message fields that may carry the answer, in precedence order. Thinking
 * models served the OpenAI-compatible way sometimes leave `content` empty and
 * put the whole answer in a reasoning field (llama.cpp's `reasoning_content`,
 * some gateways' `reasoning`), so a blank `content` alone must not read as a
 * failed description.
 */
const ANSWER_KEYS: readonly string[] = ['content', 'reasoning_content', 'reasoning']

/**
 * Extract description text from a chat-completions message field. The
 * OpenAI-compatible wire format allows a plain string or an array of typed
 * parts; some servers emit the array form even for text-only completions.
 *
 * @param content - the parsed `choices[0].message.<field>` value.
 * @returns the joined text-part text, or an empty string when unusable.
 */
export function qwenContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content as readonly unknown[]) {
    if (typeof part !== 'object' || part === null) continue
    const { type, text } = part as QwenContentPart
    if (type !== 'text' || typeof text !== 'string') continue
    parts.push(text)
  }
  return parts.join('\n')
}

/** True for a fetch/`AbortSignal` abort (deadline timeout or caller cancel). */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Render a transport failure with its underlying cause code when one rides the
 * exception — `TypeError: fetch failed` alone names no reachable diagnosis,
 * while the cause (`ECONNREFUSED`, `ETIMEDOUT`, …) does.
 *
 * @param error - the thrown transport error.
 * @returns the error's string form, suffixed with the cause code when present.
 */
function transportFailureDetail(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | null | undefined)?.cause?.code
  return typeof code === 'string' ? `${String(error)} (${code})` : String(error)
}

/** One describe attempt against one backend. */
async function describeOnce(
  backend: VisionBackendOptions,
  request: Parameters<VisionProvider['describe']>[0],
  chain: VisionChainOptions,
  signal: AbortSignal | undefined,
): Promise<VisionDescription> {
  const apiKey = await backend.resolveApiKey()
  const dataUrl = `data:${request.image.mediaType};base64,${Buffer.from(request.image.bytes).toString('base64')}`
  using d = deadline(signal, chain.timeoutMs, 'VISION_TIMEOUT')
  let response: Response
  try {
    response = await fetch(`${backend.baseURL}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {},
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        model: backend.model,
        messages: [
          { role: 'system', content: backend.instruction },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: request.prompt ?? QWEN_DEFAULT_ASK },
            ],
          },
        ],
        max_tokens: chain.maxTokens,
        temperature: chain.temperature,
        stream: false,
      }),
      signal: d.signal,
    })
  } catch (error: unknown) {
    if (isAbortError(error) || d.signal.aborted) throw new VisionError('vision request aborted', 'VISION_ABORTED', { cause: error })
    throw new VisionError(`vision backend "${backend.id}" request failed: ${transportFailureDetail(error)}`, 'VISION_PROVIDER_ERROR', { cause: error })
  }

  if (!response.ok) {
    const status = response.status
    let message = `vision backend "${backend.id}" API error (HTTP ${status})`
    try {
      const parsed = await response.json() as Record<string, unknown>
      const detail = qwenErrorDetail(parsed)
      if (detail !== undefined && detail.length > 0) message = detail
    } catch (error: unknown) {
      if (isAbortError(error)) throw new VisionError('vision request aborted', 'VISION_ABORTED', { cause: error })
      // Otherwise the HTTP status is already captured in `message` above; a
      // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
      // cost a richer provider message, never the real error.
    }
    throw new VisionError(message, 'VISION_PROVIDER_ERROR')
  }

  let payload: QwenChatResponse
  try {
    payload = await response.json() as QwenChatResponse
  } catch (error: unknown) {
    if (isAbortError(error)) throw new VisionError('vision request aborted', 'VISION_ABORTED', { cause: error })
    throw new VisionError(`vision backend "${backend.id}" returned an unprocessable response body: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error })
  }
  let text = ''
  for (const key of ANSWER_KEYS) {
    text = qwenContentText(qwenFirstMessageField(payload, key))
    if (text.trim().length > 0) break
  }
  if (text.trim().length === 0) {
    throw new VisionError(`vision backend "${backend.id}" returned no description text`, 'VISION_PROVIDER_ERROR')
  }
  const model = typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : backend.model
  return { text, model }
}

/** The OpenAI-compatible vision chain; HTTP redirects fail as `VISION_PROVIDER_ERROR`. */
export class QwenVisionProvider implements VisionProvider {
  readonly id = VISION_CHAIN_PROVIDER_ID

  constructor(private readonly chain: () => VisionChainOptions) {}

  available(): boolean {
    return this.usableBackends().length > 0
  }

  /** Backends the chain would actually try, in priority order. */
  private usableBackends(): readonly VisionBackendOptions[] {
    return this.chain().backends.filter(backend => backend.model.length > 0 && URL.canParse(backend.baseURL))
  }

  async describe(
    request: Parameters<VisionProvider['describe']>[0],
    signal?: AbortSignal,
  ): Promise<VisionDescription> {
    const chain = this.chain()
    const backends = this.usableBackends()
    if (backends.length === 0) {
      throw new VisionError('no usable vision backend is configured', 'VISION_PROVIDER_UNAVAILABLE')
    }
    const failures: string[] = []
    for (const backend of backends) {
      for (let attempt = 1; attempt <= chain.attemptsPerBackend; attempt++) {
        try {
          return await describeOnce(backend, request, chain, signal)
        } catch (error: unknown) {
          // A caller cancellation is not a backend failure; falling through
          // would keep working against the caller's wish.
          if (error instanceof VisionError && error.code === 'VISION_ABORTED' && signal?.aborted) throw error
          const detail = error instanceof Error ? error.message : String(error)
          failures.push(`${backend.id} (attempt ${attempt}/${chain.attemptsPerBackend}): ${detail}`)
          if (signal?.aborted) throw new VisionError('vision request aborted', 'VISION_ABORTED', { cause: error })
        }
      }
    }
    throw new VisionError(
      `every vision backend failed: ${failures.join('; ')}`,
      'VISION_PROVIDER_ERROR',
    )
  }
}

/** Read one field of `choices[0].message` from a chat-completions response, or `undefined`. */
function qwenFirstMessageField(payload: QwenChatResponse, field: string): unknown {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) return undefined
  const choice: unknown = payload.choices[0]
  if (typeof choice !== 'object' || choice === null) return undefined
  const message = (choice as { readonly message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  return (message as QwenResponseMessage as Record<string, unknown>)[field]
}

/**
 * Extract a human-readable detail from an OpenAI-compatible error body, which
 * nests the message under `error` (string or object) or at the top level.
 *
 * @param body - the parsed error-response body.
 * @returns the server's message, or `undefined` when the body carries none.
 */
function qwenErrorDetail(body: Record<string, unknown>): string | undefined {
  const { error, message } = body
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const nested = (error as { readonly message?: unknown }).message
    if (typeof nested === 'string') return nested
  }
  return typeof message === 'string' ? message : undefined
}
