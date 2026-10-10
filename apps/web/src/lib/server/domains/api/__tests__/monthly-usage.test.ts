import { describe, expect, it } from 'vitest'
import { secondsUntilNextUtcMonth } from '../monthly-usage'

describe('secondsUntilNextUtcMonth', () => {
  it('is at least one second and lands on the next UTC month start', () => {
    const at = new Date('2026-08-30T09:00:00.000Z')
    const seconds = secondsUntilNextUtcMonth(at)
    expect(seconds).toBe(Math.ceil((Date.UTC(2026, 8, 1) - at.getTime()) / 1000))
  })
})
