import { describe, expect, it, vi } from 'vitest'
import { mintStreamToken, verifyStreamToken } from '../stream-token'

vi.mock('../../secret-key', () => ({
  activeSecretKey: () => 'test-secret-key-at-least-32-characters-long',
}))

describe('stream token audience', () => {
  it('round-trips the bound scope', () => {
    const token = mintStreamToken('principal_1' as never, 'widget')
    expect(verifyStreamToken(token)).toEqual({ principalId: 'principal_1', scope: 'widget' })
  })

  it('defaults to dashboard', () => {
    const token = mintStreamToken('principal_1' as never)
    expect(verifyStreamToken(token)).toEqual({ principalId: 'principal_1', scope: 'dashboard' })
  })

  it('rejects a tampered signature', () => {
    const token = mintStreamToken('principal_1' as never, 'dashboard')
    expect(verifyStreamToken(`${token.slice(0, -2)}xx`)).toBeNull()
  })

  it('returns null for missing or malformed tokens', () => {
    expect(verifyStreamToken(null)).toBeNull()
    expect(verifyStreamToken('garbage')).toBeNull()
  })
})
