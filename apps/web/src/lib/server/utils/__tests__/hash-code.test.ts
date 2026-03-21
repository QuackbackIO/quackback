/**
 * Tests for hash-code utility.
 */

import { describe, it, expect } from 'vitest'
import { hashCode } from '../hash-code'

describe('hashCode', () => {
  it('returns 0 for empty string', () => {
    expect(hashCode('')).toBe(0)
  })

  it('returns consistent value for same input', () => {
    const a = hashCode('hello')
    const b = hashCode('hello')
    expect(a).toBe(b)
  })

  it('returns different values for different inputs', () => {
    expect(hashCode('hello')).not.toBe(hashCode('world'))
  })

  it('returns an integer', () => {
    const result = hashCode('test string')
    expect(Number.isInteger(result)).toBe(true)
  })

  it('handles single character', () => {
    // charCode of 'a' is 97
    expect(hashCode('a')).toBe(97)
  })

  it('handles unicode characters', () => {
    const result = hashCode('café')
    expect(Number.isInteger(result)).toBe(true)
  })

  it('handles long strings without overflow', () => {
    const long = 'a'.repeat(10000)
    const result = hashCode(long)
    expect(Number.isInteger(result)).toBe(true)
    // 32-bit integer range
    expect(result).toBeGreaterThanOrEqual(-2147483648)
    expect(result).toBeLessThanOrEqual(2147483647)
  })
})
