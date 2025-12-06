import { describe, it, expect } from 'vitest'
import { getInitials } from '../string'

describe('getInitials', () => {
  it('returns initials for full name', () => {
    expect(getInitials('John Doe')).toBe('JD')
  })

  it('returns single initial for single name', () => {
    expect(getInitials('Alice')).toBe('A')
  })

  it('returns "?" for null', () => {
    expect(getInitials(null)).toBe('?')
  })

  it('returns "?" for undefined', () => {
    expect(getInitials(undefined)).toBe('?')
  })

  it('returns "?" for empty string', () => {
    expect(getInitials('')).toBe('?')
  })

  it('limits to 2 characters for names with more than 2 words', () => {
    expect(getInitials('John Paul Smith')).toBe('JP')
  })

  it('handles names with extra spaces', () => {
    expect(getInitials('  Jane   Doe  ')).toBe('JD')
  })

  it('uppercases initials', () => {
    expect(getInitials('john doe')).toBe('JD')
  })
})
