import { describe, it, expect } from 'vitest'
import { isoFromMillis, isoTimestamp } from '@/lib/server/integrations/inbound-time'

describe('isoTimestamp', () => {
  it('normalises ISO 8601 times to UTC', () => {
    expect(isoTimestamp('2026-11-24T13:07:35.977Z')).toBe('2026-11-24T13:07:35.977Z')
    expect(isoTimestamp('2026-11-24T14:07:35+01:00')).toBe('2026-11-24T13:07:35.000Z')
  })

  it('accepts an offset without a colon', () => {
    expect(isoTimestamp('2026-11-24T13:07:35.977+0000')).toBe('2026-11-24T13:07:35.977Z')
    expect(isoTimestamp('2026-11-24T15:07:35.977+0200')).toBe('2026-11-24T13:07:35.977Z')
  })

  it('returns undefined for missing or invalid values', () => {
    for (const value of [undefined, null, '', 'not-a-date', 42, {}]) {
      expect(isoTimestamp(value)).toBeUndefined()
    }
  })
})

describe('isoFromMillis', () => {
  it('converts epoch milliseconds given as a number or a string', () => {
    expect(isoFromMillis(1764000000000)).toBe('2025-11-24T16:00:00.000Z')
    expect(isoFromMillis('1764000000000')).toBe('2025-11-24T16:00:00.000Z')
  })

  it('returns undefined for missing, non-positive or out-of-range values', () => {
    for (const value of [undefined, '', ' ', 'abc', 0, -1, 1e20, {}]) {
      expect(isoFromMillis(value)).toBeUndefined()
    }
  })
})
