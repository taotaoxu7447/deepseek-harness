/**
 * Stream-idle timeout editing for one provider profile, in the seconds a
 * person thinks in. The adapters store `streamIdleTimeoutMs` — a positive
 * Node timer delay in milliseconds — so this module is the seconds↔ms
 * spelling boundary, mirroring how the capacity fields spell K/M suffixes
 * ({@link ./DeepSeekModelsEditor.ts} `parseCapacity`): blank inherits the
 * adapter default, unreadable text is rejected before any write.
 */

/**
 * What a blank field inherits, in seconds, shown as the placeholder. Mirrors
 * both adapters' `DEFAULT_STREAM_IDLE_TIMEOUT_MS` (600,000 ms) — a hint, not
 * a mirror: nothing on this page can read the constant, and a deployment
 * override at a lower layer is shown instead of it.
 */
export const STREAM_IDLE_TIMEOUT_PLACEHOLDER_S = '600'

/**
 * The largest writable timeout, in seconds: the adapters bound the delay by
 * the maximum Node timer (2^31−1 ms), spelled here because this client
 * package does not import the Host-side timeout constant.
 */
const STREAM_IDLE_TIMEOUT_MAX_S = 2_147_483.647

/** Accepted spellings: a plain non-negative decimal number of seconds. */
const SECONDS_PATTERN = /^\d+(?:\.\d+)?$/

/**
 * Parse one seconds field into the stored milliseconds.
 * @param text - raw field text.
 * @returns the millisecond delay; `undefined` for a blank field (inherit);
 *   `NaN` when the text is not a usable positive timeout within the timer
 *   bound (the caller shows the invalid message and blocks the write).
 */
export function parseStreamIdleTimeout(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  if (SECONDS_PATTERN.exec(trimmed) === null) return Number.NaN
  const seconds = Number(trimmed)
  const ms = seconds * 1000
  // A decimal second count is exact in intent; snap sub-millisecond dust.
  const rounded = Math.round(ms)
  if (rounded <= 0 || seconds > STREAM_IDLE_TIMEOUT_MAX_S) return Number.NaN
  return rounded
}

/**
 * Spell a stored millisecond delay back as the seconds text the field edits.
 * A whole-second value stays bare; a hand-written sub-second yaml value keeps
 * its millisecond precision rather than rounding away from what is stored.
 * @param ms - the stored `streamIdleTimeoutMs`, or `undefined` when unset.
 * @returns the field text, empty when unset.
 */
export function formatStreamIdleTimeout(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (!Number.isFinite(ms) || ms <= 0) return ''
  // String(612345 / 1000) keeps the sub-second precision a hand-written yaml
  // can carry; whole seconds spell bare.
  return String(ms / 1000)
}
