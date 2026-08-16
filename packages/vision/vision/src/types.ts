/**
 * Vocabulary for the vision capability seam (`ctx.vision`): one `describe`
 * operation that turns an encoded image plus an optional focus prompt into
 * model-facing text, plus the provider interface and the error taxonomy.
 * @module @deepseek-ai/dsh-vision/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** One encoded image to describe: raw bytes plus the declared media type (for example `image/png`). */
export interface VisionImage {
  /** Encoded image bytes in the format named by `mediaType`. */
  readonly bytes: Uint8Array
  /** Declared media type of {@link VisionImage.bytes}. */
  readonly mediaType: string
}

/** One description request: the image plus the aspect the caller wants described. */
export interface VisionDescribeRequest {
  /** The image to describe. */
  readonly image: VisionImage
  /**
   * What the caller wants to know about the image. Omitted = the provider's
   * own default describe instruction.
   */
  readonly prompt?: string
}

/** A completed description of one image. */
export interface VisionDescription {
  /** Model-facing description text. */
  readonly text: string
  /** The vision model that produced the text (server-reported, else configured). */
  readonly model: string
}

/**
 * One vision-capable backend. Providers validate nothing about the image:
 * media-type and byte-cap validation belong to the caller (the `view_image`
 * tool defers to the attachment service's image policy before describing).
 */
export interface VisionProvider {
  /** Stable id this provider registers under. */
  readonly id: string
  /** False when the provider cannot serve requests (for example missing config). */
  available(): boolean
  /**
   * Describe one image.
   * @param request - the image and optional focus prompt.
   * @param signal - optional cancellation forwarded to the backend call.
   * @returns the description text and the producing model.
   */
  describe(request: VisionDescribeRequest, signal?: AbortSignal): Promise<VisionDescription>
}

/** Stable machine-routable failure classes of the vision seam and its providers. */
export type VisionErrorCode =
  | 'VISION_DUPLICATE_PROVIDER'
  | 'VISION_PROVIDER_CONFIGURED_MISSING'
  | 'VISION_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'VISION_PROVIDER_UNAVAILABLE'
  | 'VISION_PROVIDER_AMBIGUOUS'
  | 'VISION_ABORTED'
  | 'VISION_PROVIDER_ERROR'

/** Vision-seam error: route on {@link VisionError.code}, never by parsing `message`. */
export class VisionError extends HarnessError {}
