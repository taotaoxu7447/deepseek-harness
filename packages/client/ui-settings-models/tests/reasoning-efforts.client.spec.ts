/** The reasoning-effort declaration's compact text form: presets, parsing, and formatting. */

import { describe, expect, it } from 'vitest'
import {
  EFFORT_PRESETS,
  effortPresetText,
  formatReasoningEfforts,
  parseReasoningEfforts,
} from '../src/client/reasoning-efforts.ts'

describe('formatReasoningEfforts', () => {
  it('spells inherit, disable, and level maps', () => {
    expect(formatReasoningEfforts(undefined)).toBe('')
    expect(formatReasoningEfforts(false)).toBe('false')
    expect(formatReasoningEfforts({ off: null, high: 'high', max: 'max' })).toBe('off, high, max')
    expect(formatReasoningEfforts({ off: null, high: 'high', max: 'ultra' })).toBe('off, high, max=ultra')
  })

  it('keeps escalation order regardless of storage order and skips foreign shapes', () => {
    expect(formatReasoningEfforts({ max: 'max', off: null })).toBe('off, max')
    expect(formatReasoningEfforts('nonsense')).toBe('')
    expect(formatReasoningEfforts(null)).toBe('')
  })
})

describe('parseReasoningEfforts', () => {
  it('parses inherit, disable, bare levels, and level=wire mappings', () => {
    expect(parseReasoningEfforts('')).toEqual({ ok: true, value: undefined })
    expect(parseReasoningEfforts('   ')).toEqual({ ok: true, value: undefined })
    expect(parseReasoningEfforts('false')).toEqual({ ok: true, value: false })
    expect(parseReasoningEfforts('off, high, max')).toEqual({ ok: true, value: { off: null, high: 'high', max: 'max' } })
    expect(parseReasoningEfforts('off, high=high, max=ultra')).toEqual({ ok: true, value: { off: null, high: 'high', max: 'ultra' } })
    expect(parseReasoningEfforts(' xhigh ')).toEqual({ ok: true, value: { xhigh: 'xhigh' } })
  })

  it('round-trips every preset through format', () => {
    for (const preset of EFFORT_PRESETS) {
      const text = effortPresetText(preset)
      const parsed = parseReasoningEfforts(text)
      expect(parsed.ok).toBe(true)
      expect(parsed.ok ? parsed.value : undefined).toEqual(expect.any(Object))
      expect(formatReasoningEfforts(parsed.ok ? parsed.value : undefined)).toBe(text)
    }
  })

  it('rejects unknown levels, empty wires beyond off, off-only, and empty entries', () => {
    expect(parseReasoningEfforts('turbo')).toEqual({ ok: false, reason: 'unknownLevel' })
    expect(parseReasoningEfforts('high=')).toEqual({ ok: false, reason: 'emptyWire' })
    expect(parseReasoningEfforts('off')).toEqual({ ok: false, reason: 'offOnly' })
    expect(parseReasoningEfforts('off,')).toEqual({ ok: false, reason: 'emptyEntry' })
    expect(parseReasoningEfforts('high, , max')).toEqual({ ok: false, reason: 'emptyEntry' })
  })
})

describe('EFFORT_PRESETS', () => {
  it('covers the three vendor spellings the Models page offers', () => {
    expect(EFFORT_PRESETS.map(preset => preset.id)).toEqual(['deepseek-v4', 'openai-grades', 'all-levels'])
    expect(effortPresetText(EFFORT_PRESETS[0]!)).toBe('off, high, max')
    expect(effortPresetText(EFFORT_PRESETS[1]!)).toBe('minimal, low, medium, high')
  })
})
