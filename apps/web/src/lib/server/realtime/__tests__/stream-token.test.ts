import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { mintStreamToken, verifyStreamToken } from '../stream-token'

const TEST_KEY = 'test-secret-key-at-least-32-characters-long'

vi.mock('../../secret-key', () => ({
  activeSecretKey: () => TEST_KEY,
}))

/** Pre-scope token shape: `${principalId}.${expiry}`. */
function legacyStreamToken(principalId: string, ttlMs = 60_000): string {
  const payload = `${principalId}.${Date.now() + ttlMs}`
  const signature = createHmac('sha256', TEST_KEY)
    .update(`chat-stream:v1\n${payload}`)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${signature}`
}

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

  it('rejects audience-less legacy tokens', () => {
    expect(verifyStreamToken(legacyStreamToken('principal_1'))).toBeNull()
  })
})
