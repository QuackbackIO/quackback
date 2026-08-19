import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

let secretKey = 'test-secret-key-oauth-state'

vi.mock('@/lib/server/config', () => ({
  config: {
    get secretKey() {
      return secretKey
    },
  },
}))

import { signOAuthState, verifyOAuthState } from '../oauth-state'

interface TestState {
  integration: string
  redirect: string
}

const state: TestState = { integration: 'slack', redirect: '/admin/settings/integrations/slack' }

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips a signed state object', () => {
    const signed = signOAuthState(state)
    expect(verifyOAuthState<TestState>(signed)).toEqual(state)
  })

  it('produces payload.signature in base64url with exactly one separator boundary', () => {
    const signed = signOAuthState(state)
    const separatorIndex = signed.lastIndexOf('.')
    expect(separatorIndex).toBeGreaterThan(0)
    // Both halves must be base64url (no +, /, or = padding)
    expect(signed).not.toMatch(/[+/=]/)
  })

  it('rejects a tampered payload', () => {
    const signed = signOAuthState(state)
    const [payload, signature] = [
      signed.slice(0, signed.lastIndexOf('.')),
      signed.slice(signed.lastIndexOf('.') + 1),
    ]
    const forged = Buffer.from(
      JSON.stringify({ ...state, redirect: 'https://evil.example' })
    ).toString('base64url')
    expect(forged).not.toBe(payload)
    expect(verifyOAuthState(`${forged}.${signature}`)).toBeNull()
  })

  it('rejects a tampered signature of the same length', () => {
    const signed = signOAuthState(state)
    const separatorIndex = signed.lastIndexOf('.')
    const signature = signed.slice(separatorIndex + 1)
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    expect(verifyOAuthState(signed.slice(0, separatorIndex + 1) + flipped)).toBeNull()
  })

  it('rejects a truncated signature (length mismatch path)', () => {
    const signed = signOAuthState(state)
    expect(verifyOAuthState(signed.slice(0, -2))).toBeNull()
  })

  it('rejects input with no separator', () => {
    expect(verifyOAuthState('no-separator-here')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(verifyOAuthState('')).toBeNull()
  })

  it('rejects a payload that is not JSON even when correctly signed-looking', () => {
    // Craft payload whose decoded bytes are not JSON; signature cannot match anyway
    const junk = Buffer.from('not json at all').toString('base64url')
    expect(verifyOAuthState(`${junk}.${junk}`)).toBeNull()
  })

  it('rejects a state signed under a different secret', () => {
    const signed = signOAuthState(state)
    secretKey = 'rotated-secret-key-oauth-state'
    try {
      expect(verifyOAuthState(signed)).toBeNull()
    } finally {
      secretKey = 'test-secret-key-oauth-state'
    }
  })

  it('verifies non-object roundtrip content faithfully (arrays)', () => {
    const signed = signOAuthState([1, 2, 3] as unknown as object)
    expect(verifyOAuthState<number[]>(signed)).toEqual([1, 2, 3])
  })
})
