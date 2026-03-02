import { describe, it, expect } from 'vitest'
import { toIsoString, toIsoStringOrNull } from '..'

describe('toIsoString', () => {
  it('converts a Date object to ISO string', () => {
    const date = new Date('2025-06-15T12:00:00.000Z')
    expect(toIsoString(date)).toBe('2025-06-15T12:00:00.000Z')
  })

  it('handles dates at epoch', () => {
    const epoch = new Date(0)
    expect(toIsoString(epoch)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('handles dates with time components', () => {
    const date = new Date('2025-12-31T23:59:59.999Z')
    expect(toIsoString(date)).toBe('2025-12-31T23:59:59.999Z')
  })

  it('returns the string as-is when given a string', () => {
    const iso = '2025-06-15T12:00:00.000Z'
    expect(toIsoString(iso)).toBe(iso)
  })
})

describe('toIsoStringOrNull', () => {
  it('returns ISO string for a valid Date', () => {
    const date = new Date('2025-06-15T12:00:00.000Z')
    expect(toIsoStringOrNull(date)).toBe('2025-06-15T12:00:00.000Z')
  })

  it('returns null for null input', () => {
    expect(toIsoStringOrNull(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(toIsoStringOrNull(undefined)).toBeNull()
  })

  it('returns the string as-is when given a string', () => {
    const iso = '2025-06-15T12:00:00.000Z'
    expect(toIsoStringOrNull(iso)).toBe(iso)
  })
})
