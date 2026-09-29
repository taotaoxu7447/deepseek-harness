/**
 * Service Definition for the vision capability seam (`ctx.vision`): a provider
 * registry and describe dispatch for turning images into model-facing text
 * through a swappable vision model backend. Duplicate ids are rejected; at
 * execution time exactly one usable provider must exist, so selection never
 * depends on registration order.
 * @module @deepseek-ai/dsh-vision
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { VisionDescribeRequest, VisionDescription, VisionProvider } from './types.ts'
import { VisionError } from './types.ts'

export { VisionError } from './types.ts'
export type {
  VisionDescribeRequest,
  VisionDescription,
  VisionErrorCode,
  VisionImage,
  VisionProvider,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vision: VisionRuntime
  }
}

/**
 * Config for the vision seam. `provider` pins which registered provider serves
 * `describe`; omitted auto-selects when exactly one usable provider is
 * registered. Operational overrides must feed this same field rather than
 * introduce a hidden priority chain.
 */
export interface VisionRuntimeConfig {
  /** Explicit vision provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
}

/**
 * The vision service. Registered as `ctx.vision` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `VISION_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `VISION_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `VISION_PROVIDER_UNAVAILABLE`.
 */
export class VisionRuntime extends Service {
  /** Provider selection config; `provider` names the registry key to use. */
  static Config: z<VisionRuntimeConfig> = z.object({
    provider: z.string(),
  })

  private providers = new Map<string, VisionProvider>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: VisionRuntimeConfig = {}) {
    super(ctx, 'vision')
    this.providerId = config.provider
  }

  /**
   * Register a vision provider. Throws {@link VisionError}
   * `VISION_DUPLICATE_PROVIDER` if its id is already registered. Returns a
   * disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: VisionProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new VisionError(`a vision provider with id "${provider.id}" is already registered`, 'VISION_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'vision.registerProvider()')
    return () => void dispose()
  }

  /**
   * Describe one image through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link VisionError} when
   * the capability cannot run or the provider call fails.
   * @param request - the image and optional focus prompt.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the description text and the producing model.
   */
  async describe(request: VisionDescribeRequest, signal?: AbortSignal): Promise<VisionDescription> {
    const provider = resolveProvider(this.providers, this.providerId)
    return provider.describe(request, signal)
  }

  /**
   * Whether selection would succeed right now — the non-throwing form of the
   * same rules {@link describe} resolves with. Admission surfaces use it to
   * decide whether an image has an out-of-band path into the conversation
   * before any message is logged.
   * @returns true when a configured-or-single usable provider exists.
   */
  hasUsableProvider(): boolean {
    const configured = this.providerId !== undefined ? this.providers.get(this.providerId) : undefined
    if (configured !== undefined) return configured.available()
    return [...this.providers.values()].some(provider => provider.available())
  }
}

/** A provider candidate for selection. */
interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link VisionError}. */
function resolveProvider<P extends ResolvableProvider>(providers: ReadonlyMap<string, P>, configuredId: string | undefined): P {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new VisionError(`configured vision provider "${configuredId}" is not registered`, 'VISION_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new VisionError(`configured vision provider "${configuredId}" is registered but unavailable`, 'VISION_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new VisionError('no usable vision provider is registered', 'VISION_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new VisionError(`multiple usable vision providers are registered (${ids}); configure one explicitly`, 'VISION_PROVIDER_AMBIGUOUS')
  }
  return single
}

export default VisionRuntime
