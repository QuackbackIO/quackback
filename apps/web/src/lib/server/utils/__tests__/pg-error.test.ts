import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from '../pg-error'

describe('isUniqueViolation', () => {
  it('detects a bare driver unique violation (code on the error)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('detects a Drizzle-wrapped unique violation (code on cause)', () => {
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true)
  })

  it('is false for a different pg error code', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false)
  })

  it('is false for null, undefined, and non-error values', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('boom')).toBe(false)
    expect(isUniqueViolation({})).toBe(false)
  })
})
