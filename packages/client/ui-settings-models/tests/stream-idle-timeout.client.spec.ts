// @vitest-environment node
/** Seconds↔milliseconds spelling of the stream-idle timeout field. */
import { describe, expect, it } from 'vitest'
import {
  formatStreamIdleTimeout,
  parseStreamIdleTimeout,
  STREAM_IDLE_TIMEOUT_PLACEHOLDER_S,
} from '../src/client/stream-idle-timeout.ts'

describe('parseStreamIdleTimeout', () => {
  it('reads blank as inherit', () => {
    expect(parseStreamIdleTimeout('')).toBeUndefined()
    expect(parseStreamIdleTimeout('   ')).toBeUndefined()
  })

  it('scales whole and fractional seconds to milliseconds', () => {
    expect(parseStreamIdleTimeout('600')).toBe(600_000)
    expect(parseStreamIdleTimeout(' 900 ')).toBe(900_000)
    expect(parseStreamIdleTimeout('1.5')).toBe(1500)
  })

  it('accepts the timer bound and refuses what crosses it', () => {
    expect(parseStreamIdleTimeout('2147483.647')).toBe(2_147_483_647)
    expect(parseStreamIdleTimeout('2147483.648')).toBeNaN()
  })

  it('refuses non-numbers, non-positive values, and exponents', () => {
    expect(parseStreamIdleTimeout('soon')).toBeNaN()
    expect(parseStreamIdleTimeout('-5')).toBeNaN()
    expect(parseStreamIdleTimeout('0')).toBeNaN()
    expect(parseStreamIdleTimeout('1e3')).toBeNaN()
  })
})

describe('formatStreamIdleTimeout', () => {
  it('spells stored milliseconds as seconds', () => {
    expect(formatStreamIdleTimeout(600_000)).toBe('600')
    expect(formatStreamIdleTimeout(612_345)).toBe('612.345')
  })

  it('spells unset and unusable values as empty', () => {
    expect(formatStreamIdleTimeout(undefined)).toBe('')
    expect(formatStreamIdleTimeout(0)).toBe('')
    expect(formatStreamIdleTimeout(-1)).toBe('')
    expect(formatStreamIdleTimeout(Number.NaN)).toBe('')
    expect(formatStreamIdleTimeout(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('STREAM_IDLE_TIMEOUT_PLACEHOLDER_S', () => {
  it('matches the adapters’ ten-minute default', () => {
    expect(STREAM_IDLE_TIMEOUT_PLACEHOLDER_S).toBe('600')
  })
})
