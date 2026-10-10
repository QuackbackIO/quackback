import { describe, expect, it } from 'vitest'
import { parseFlexibleDate } from '../helpers'

describe('parseFlexibleDate', () => {
  it('parses ISO datetimes', () => {
    expect(parseFlexibleDate('2024-06-01')?.toISOString()).toBe('2024-06-01T00:00:00.000Z')
  })

  it('parses relative day windows', () => {
    const parsed = parseFlexibleDate('7d')
    expect(parsed).toBeInstanceOf(Date)
    expect(Date.now() - parsed!.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(Date.now() - parsed!.getTime()).toBeLessThan(8 * 24 * 60 * 60 * 1000)
  })

  it('parses this_month as the UTC month start', () => {
    const parsed = parseFlexibleDate('this_month')!
    const now = new Date()
    expect(parsed.toISOString()).toBe(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    )
  })

  it('returns undefined for empty or unknown values', () => {
    expect(parseFlexibleDate()).toBeUndefined()
    expect(parseFlexibleDate('')).toBeUndefined()
    expect(parseFlexibleDate('not-a-date')).toBeUndefined()
  })
})
