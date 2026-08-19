import { describe, expect, it } from 'vitest'
import { rawSessionToken } from '../session-token'

describe('rawSessionToken', () => {
  it('returns a raw token unchanged', () => {
    expect(rawSessionToken('abc123XYZ')).toBe('abc123XYZ')
  })

  it('returns a UUID-style widget token unchanged', () => {
    expect(rawSessionToken('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })

  it('strips the signature from the signed bearer form', () => {
    expect(rawSessionToken('abc123XYZ.c2lnbmF0dXJl')).toBe('abc123XYZ')
  })

  it('splits on the first dot only', () => {
    expect(rawSessionToken('token.sig.with.dots')).toBe('token')
  })

  it('handles an empty string', () => {
    expect(rawSessionToken('')).toBe('')
  })
})
