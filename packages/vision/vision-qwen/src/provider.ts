/**
 * The vision chain provider: every configured backend in priority order, with
 * per-backend attempt budgets and fallback. One backend's failure after its
 * budget falls to the next priority; caller cancellation never falls through.
 * Each backend speaks one of three wire protocols — OpenAI chat completions
 * (local vLLM/SGLang/llama.cpp Qwen VL and most compatible gateways), OpenAI
 * Responses (api.xiaomimimo.com and GPT-5-class endpoints), or Anthropic
 * Messages — and the image rides the request as base64 either way.
 *
 * Options resolve per call from a thunk, so a settings-section change reaches
 * the very next describe without re-registering the provider.
 * @module @deepseek-ai/dsh-vision-qwen/provider
 */

import { Buffer } from 'node:buffer'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { VisionError } from '@deepseek-ai/dsh-vision'
import type { VisionDescription, VisionDescribeRequest, VisionImage, VisionProvider } from '@deepseek-ai/dsh-vision'
import { anthropicEffortFragment, chatEffortFragment, responsesEffortFragment } from './effort.ts'
import type { VisionEffortOptions } from './effort.ts'
import { probeImagePixels } from './image-size.ts'

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

/** Wire protocols one backend may speak. */
export type VisionProtocol = 'openai-chat' | 'openai-responses' | 'anthropic'

/** Protocol a backend falls back to when its config names none. */
export const VISION_DEFAULT_PROTOCOL: VisionProtocol = 'openai-chat'

/** `anthropic-version` header value; a protocol constant pinned to the implemented Messages revision. */
export const ANTHROPIC_API_VERSION = '2023-06-01'

/** Anthropic's minimum extended-thinking budget (tokens); validation rejects smaller budgets up front. */
export const ANTHROPIC_MIN_THINKING_BUDGET = 1024

/** Chars per token in the input estimate's text term. */
export const TEXT_CHARS_PER_TOKEN = 4

/** Pixels per token in the input estimate's image term (a conservative high-detail reading). */
export const PIXELS_PER_IMAGE_TOKEN = 750

/** One resolved backend for a describe call (the plugin's `apply` builds each from the section). */
export interface VisionBackendOptions extends VisionEffortOptions {
  /** Stable id naming this backend in errors and credential references. */
  id: string
  /** Vision model id the endpoint serves; empty = not configured. */
  model: string
  /** Endpoint base; the protocol's path is appended; empty = not configured. */
  baseURL: string
  /** Wire protocol this backend speaks. */
  protocol: VisionProtocol
  /** Estimated-input guard (tokens); a describe whose estimate exceeds it is refused before any request. */
  maxInputTokens?: number
  /**
   * Resolve the API key for an attempt; an empty string sends no
   * authorization header (a keyless local endpoint).
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
 * Message fields that may carry the answer on the chat-completions wire, in
 * precedence order. Thinking models served the OpenAI-compatible way
 * sometimes leave `content` empty and put the whole answer in a reasoning
 * field (llama.cpp's `reasoning_content`, some gateways' `reasoning`), so a
 * blank `content` alone must not read as a failed description.
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

/**
 * Estimate one describe's input size in tokens: text at
 * {@link TEXT_CHARS_PER_TOKEN} chars per token plus the image at
 * {@link PIXELS_PER_IMAGE_TOKEN} pixels per token from its probed dimensions,
 * or — when the header is unreadable — the encoded byte count at the text
 * rate. The estimate guards configured input limits; it is not a billing
 * figure.
 *
 * @param instruction - the backend's system instruction.
 * @param prompt - the effective user-turn text.
 * @param image - the encoded image.
 * @returns the estimated input tokens.
 */
export function estimateInputTokens(instruction: string, prompt: string, image: VisionImage): number {
  const text = Math.ceil((instruction.length + prompt.length) / TEXT_CHARS_PER_TOKEN)
  const pixels = probeImagePixels(image.bytes, image.mediaType)
  return text + (pixels === undefined
    ? Math.ceil(image.bytes.length / TEXT_CHARS_PER_TOKEN)
    : Math.ceil((pixels.width * pixels.height) / PIXELS_PER_IMAGE_TOKEN))
}

/** One backend's request in wire form, plus its response parser. */
interface BuiltVisionRequest {
  /** Path appended to the backend's base URL. */
  readonly path: string
  /** Body serialized as JSON. */
  readonly body: Record<string, unknown>
  /**
   * Parse a successful response into the description.
   * @param payload - the parsed response body.
   * @returns the description text and the producing model.
   */
  readonly parse: (payload: unknown) => VisionDescription
}

/** The image in its two wire encodings. */
interface EncodedImage {
  /** Raw base64 (Anthropic `source.data`). */
  readonly base64: string
  /** `data:` URL (OpenAI image parts). */
  readonly dataUrl: string
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

/** Server-reported model id, falling back to the configured one. */
function reportedModel(payload: { readonly model?: unknown }, fallback: string): string {
  return typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : fallback
}

/** Fail a parsed response whose text never materialized. */
function requireText(backend: VisionBackendOptions, text: string, model: string): VisionDescription {
  if (text.trim().length === 0) {
    throw new VisionError(`vision backend "${backend.id}" returned no description text`, 'VISION_PROVIDER_ERROR')
  }
  return { text, model }
}

/** Parse a chat-completions response: the reasoning-field fallbacks, then the text check. */
function parseChatCompletion(backend: VisionBackendOptions, payload: unknown): VisionDescription {
  const response = payload as QwenChatResponse
  for (const key of ANSWER_KEYS) {
    const text = qwenContentText(qwenFirstMessageField(response, key))
    if (text.trim().length > 0) return requireText(backend, text, reportedModel(response, backend.model))
  }
  return requireText(backend, '', reportedModel(response, backend.model))
}

/** One `output[]` item of a Responses reply, after JSON parsing. */
interface ResponsesOutputItem {
  readonly type?: unknown
  readonly content?: unknown
}

/** Parse a Responses reply: the `output_text` convenience field, else the walked message items. */
function parseResponses(backend: VisionBackendOptions, payload: unknown): VisionDescription {
  const response = payload as { readonly model?: unknown; readonly output_text?: unknown; readonly output?: unknown }
  const model = reportedModel(response, backend.model)
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return requireText(backend, response.output_text, model)
  }
  if (Array.isArray(response.output)) {
    const parts: string[] = []
    for (const item of response.output as readonly unknown[]) {
      if (typeof item !== 'object' || item === null) continue
      const output = item as ResponsesOutputItem
      if (output.type !== 'message' || !Array.isArray(output.content)) continue
      for (const part of output.content as readonly unknown[]) {
        if (typeof part !== 'object' || part === null) continue
        const { type, text } = part as QwenContentPart
        if (type === 'output_text' && typeof text === 'string') parts.push(text)
      }
    }
    if (parts.join('\n').trim().length > 0) return requireText(backend, parts.join('\n'), model)
  }
  return requireText(backend, '', model)
}

/** Parse an Anthropic Messages reply: the text blocks of `content`, thinking blocks dropped. */
function parseAnthropicMessages(backend: VisionBackendOptions, payload: unknown): VisionDescription {
  const response = payload as { readonly model?: unknown; readonly content?: unknown }
  return requireText(backend, qwenContentText(response.content), reportedModel(response, backend.model))
}

function buildChatCompletion(
  backend: VisionBackendOptions,
  ask: string,
  chain: VisionChainOptions,
  image: EncodedImage,
): BuiltVisionRequest {
  return {
    path: '/chat/completions',
    body: {
      model: backend.model,
      messages: [
        { role: 'system', content: backend.instruction },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image.dataUrl } },
            { type: 'text', text: ask },
          ],
        },
      ],
      max_tokens: chain.maxTokens,
      temperature: chain.temperature,
      stream: false,
      ...chatEffortFragment(backend),
    },
    parse: payload => parseChatCompletion(backend, payload),
  }
}

function buildResponsesRequest(
  backend: VisionBackendOptions,
  ask: string,
  chain: VisionChainOptions,
  image: EncodedImage,
): BuiltVisionRequest {
  return {
    path: '/responses',
    body: {
      model: backend.model,
      instructions: backend.instruction,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: image.dataUrl },
            { type: 'input_text', text: ask },
          ],
        },
      ],
      max_output_tokens: chain.maxTokens,
      stream: false,
      // Reasoning endpoints on this protocol reject any temperature but the
      // default; the chain's sampling choice stays on the chat-completions wire.
      ...responsesEffortFragment(backend),
    },
    parse: payload => parseResponses(backend, payload),
  }
}

function buildAnthropicMessages(
  backend: VisionBackendOptions,
  ask: string,
  chain: VisionChainOptions,
  image: EncodedImage,
  mediaType: string,
): BuiltVisionRequest {
  const effort = anthropicEffortFragment(backend)
  return {
    path: '/v1/messages',
    body: {
      model: backend.model,
      max_tokens: chain.maxTokens,
      system: backend.instruction,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.base64 } },
            { type: 'text', text: ask },
          ],
        },
      ],
      // Extended thinking rejects non-default sampling; with thinking off the
      // chain's temperature applies.
      ...'thinking' in effort ? {} : { temperature: chain.temperature },
      ...effort,
    },
    parse: payload => parseAnthropicMessages(backend, payload),
  }
}

/** Build one backend's request from its protocol. */
function buildVisionRequest(
  backend: VisionBackendOptions,
  ask: string,
  chain: VisionChainOptions,
  image: EncodedImage,
  mediaType: string,
): BuiltVisionRequest {
  switch (backend.protocol) {
    case 'openai-chat': return buildChatCompletion(backend, ask, chain, image)
    case 'openai-responses': return buildResponsesRequest(backend, ask, chain, image)
    case 'anthropic': return buildAnthropicMessages(backend, ask, chain, image, mediaType)
    /* v8 ignore next -- VisionProtocol is closed and every member is handled above */
    default: return assertNever(backend.protocol)
  }
}

/**
 * Authorization and version headers for one attempt. Anthropic endpoints take
 * `x-api-key` plus the version header; an Anthropic-compatible proxy may key
 * off `authorization` instead, so both travel together — mirroring the web
 * search provider's Anthropic path. Chat and Responses send a bearer token.
 */
function protocolHeaders(protocol: VisionProtocol, apiKey: string): Record<string, string> {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-responses':
      return apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {}
    case 'anthropic':
      return {
        'anthropic-version': ANTHROPIC_API_VERSION,
        ...apiKey.length > 0 ? { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}` } : {},
      }
    /* v8 ignore next -- VisionProtocol is closed and every member is handled above */
    default: return assertNever(protocol)
  }
}

/** Refuse a describe whose estimated input exceeds the backend's configured limit, before any request leaves. */
function guardInputLimit(backend: VisionBackendOptions, image: VisionImage, ask: string): void {
  if (backend.maxInputTokens === undefined) return
  const estimate = estimateInputTokens(backend.instruction, ask, image)
  if (estimate <= backend.maxInputTokens) return
  throw new VisionError(
    `vision backend "${backend.id}" estimated input of ${estimate} tokens exceeds its configured limit of ${backend.maxInputTokens}`,
    'VISION_INPUT_TOO_LARGE',
  )
}

/** One describe attempt against one backend. */
async function describeOnce(
  backend: VisionBackendOptions,
  request: VisionDescribeRequest,
  chain: VisionChainOptions,
  signal: AbortSignal | undefined,
): Promise<VisionDescription> {
  const apiKey = await backend.resolveApiKey()
  const ask = request.prompt ?? QWEN_DEFAULT_ASK
  guardInputLimit(backend, request.image, ask)
  const base64 = Buffer.from(request.image.bytes).toString('base64')
  const built = buildVisionRequest(backend, ask, chain, {
    base64,
    dataUrl: `data:${request.image.mediaType};base64,${base64}`,
  }, request.image.mediaType)
  using d = deadline(signal, chain.timeoutMs, 'VISION_TIMEOUT')
  let response: Response
  try {
    response = await fetch(`${backend.baseURL}${built.path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...protocolHeaders(backend.protocol, apiKey),
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(built.body),
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

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error: unknown) {
    if (isAbortError(error)) throw new VisionError('vision request aborted', 'VISION_ABORTED', { cause: error })
    throw new VisionError(`vision backend "${backend.id}" returned an unprocessable response body: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error })
  }
  return built.parse(payload)
}

/** The multi-protocol vision chain; HTTP redirects fail as `VISION_PROVIDER_ERROR`. */
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
          // An input the backend refused for its size fails every retry of
          // the same request; only the next priority, with its own limit, can
          // still serve it.
          if (error instanceof VisionError && error.code === 'VISION_INPUT_TOO_LARGE') break
        }
      }
    }
    throw new VisionError(
      `every vision backend failed: ${failures.join('; ')}`,
      'VISION_PROVIDER_ERROR',
    )
  }
}

/**
 * Extract a human-readable detail from an error body, which nests the message
 * under `error` (string or object — the OpenAI and Anthropic shapes) or at
 * the top level.
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
