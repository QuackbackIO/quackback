import { describe, expect, it } from 'vitest'
import { hasPgErrorCode, isUniqueViolation } from '../pg-error'

describe('hasPgErrorCode', () => {
  it('detects a bare driver error (code on the error)', () => {
    expect(hasPgErrorCode({ code: '42P01' }, '42P01')).toBe(true)
  })

  it('detects a Drizzle-wrapped error (code on cause)', () => {
    expect(hasPgErrorCode({ cause: { code: '42P01' } }, '42P01')).toBe(true)
  })

  it('is false when the code differs at both levels', () => {
    expect(hasPgErrorCode({ code: '23505' }, '42P01')).toBe(false)
    expect(hasPgErrorCode({ cause: { code: '23505' } }, '42P01')).toBe(false)
  })

  it('is false for null, undefined, and non-error values', () => {
    expect(hasPgErrorCode(null, '42P01')).toBe(false)
    expect(hasPgErrorCode(undefined, '42P01')).toBe(false)
    expect(hasPgErrorCode('boom', '42P01')).toBe(false)
    expect(hasPgErrorCode({}, '42P01')).toBe(false)
  })
})

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
