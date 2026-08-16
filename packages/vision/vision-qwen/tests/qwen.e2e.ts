import { describe, expect, it } from 'vitest'
import {
  QwenVisionProvider,
  QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
  QWEN_DEFAULT_INSTRUCTION,
  QWEN_DEFAULT_MAX_TOKENS,
  QWEN_DEFAULT_TEMPERATURE,
  QWEN_DEFAULT_TIMEOUT_MS,
} from '@deepseek-ai/dsh-vision-qwen'

/**
 * Real-endpoint smoke for the vision chain against the deployment named by
 * `$QWEN_BASE_URL` + `$QWEN_API_KEY` (a local vLLM/SGLang/llama.cpp server or
 * another OpenAI-compatible endpoint). Self-skips without both, per the
 * with-key e2e policy in docs/testing.md.
 */
const baseURL = process.env.QWEN_BASE_URL
const apiKey = process.env.QWEN_API_KEY ?? ''
const model = process.env.QWEN_VISION_MODEL
const maybe = baseURL !== undefined && baseURL.length > 0 && model !== undefined && model.length > 0 ? describe : describe.skip

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
))

maybe('QwenVisionProvider real endpoint', () => {
  it('describes a real image', async () => {
    const provider = new QwenVisionProvider(() => ({
      backends: [{
        id: 'live',
        model: model!,
        baseURL: baseURL!,
        resolveApiKey: async () => apiKey,
        instruction: QWEN_DEFAULT_INSTRUCTION,
      }],
      attemptsPerBackend: QWEN_DEFAULT_ATTEMPTS_PER_BACKEND,
      temperature: QWEN_DEFAULT_TEMPERATURE,
      maxTokens: QWEN_DEFAULT_MAX_TOKENS,
      timeoutMs: QWEN_DEFAULT_TIMEOUT_MS,
    }))
    const description = await provider.describe({ image: { bytes: PNG_1X1, mediaType: 'image/png' }, prompt: 'What color is this image? Answer in one word.' })
    expect(description.text.trim().length).toBeGreaterThan(0)
    expect(description.model.length).toBeGreaterThan(0)
  }, 120_000)
})
