import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const { verifyProxyUploadToken } = await import('@/lib/server/storage/s3')

const SECRET = 'test-secret-key'
const KEY = 'avatars/2024/01/abc123-photo.png'
const CT = 'image/png'

function makeToken(secret: string, key: string, ct: string, exp: number) {
  const sig = createHmac('sha256', secret).update(`${key}|${ct}|${exp}`).digest('hex').slice(0, 32)
  return { exp: String(exp), sig }
}

function validToken() {
  return makeToken(SECRET, KEY, CT, Date.now() + 60_000)
}

describe('verifyProxyUploadToken', () => {
  it('returns true for a valid token', () => {
    const { exp, sig } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, sig)).toBe(true)
  })

  it('returns false when exp is null', () => {
    const { sig } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, null, sig)).toBe(false)
  })

  it('returns false when sig is null', () => {
    const { exp } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, null)).toBe(false)
  })

  it('returns false for an expired token', () => {
    const exp = Date.now() - 1
    const { sig } = makeToken(SECRET, KEY, CT, exp)
    expect(verifyProxyUploadToken(SECRET, KEY, CT, String(exp), sig)).toBe(false)
  })

  it('returns false for a tampered signature', () => {
    const { exp } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, 'a'.repeat(32))).toBe(false)
  })

  it('returns false when key does not match the signed key', () => {
    const { exp, sig } = validToken()
    expect(verifyProxyUploadToken(SECRET, 'logos/other.png', CT, exp, sig)).toBe(false)
  })

  it('returns false when content-type does not match the signed content-type', () => {
    const { exp, sig } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, 'image/jpeg', exp, sig)).toBe(false)
  })

  it('returns false when signed with a different secret', () => {
    const { exp, sig } = makeToken('different-secret', KEY, CT, Date.now() + 60_000)
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, sig)).toBe(false)
  })

  it('returns false for non-numeric exp', () => {
    const { sig } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, 'not-a-number', sig)).toBe(false)
  })

  it('returns false for a sig of wrong length without throwing', () => {
    const { exp } = validToken()
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, 'short')).toBe(false)
    expect(verifyProxyUploadToken(SECRET, KEY, CT, exp, 'a'.repeat(64))).toBe(false)
  })
})
