import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { createWidgetIdentityToken, verifyHS256JWT } from '@/lib/server/widget/identity-token'

describe('Widget Identify — verifyHS256JWT', () => {
  const SECRET = 'wgt_' + 'a'.repeat(64)

  function makeJWT(payload: Record<string, unknown>, secret: string, alg = 'HS256'): string {
    const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${signature}`
  }

  it('verifies a valid HS256 JWT', () => {
    const token = makeJWT({ sub: 'user_123', email: 'test@example.com' }, SECRET)
    const result = verifyHS256JWT(token, SECRET)
    expect(result).not.toBeNull()
    expect(result?.sub).toBe('user_123')
    expect(result?.email).toBe('test@example.com')
  })

  it('rejects a JWT signed with wrong secret', () => {
    const token = makeJWT({ sub: 'user_123', email: 'test@example.com' }, 'wrong_secret')
    expect(verifyHS256JWT(token, SECRET)).toBeNull()
  })

  it('rejects an expired JWT', () => {
    const token = makeJWT(
      { sub: 'user_123', email: 'test@example.com', exp: Math.floor(Date.now() / 1000) - 3600 },
      SECRET
    )
    expect(verifyHS256JWT(token, SECRET)).toBeNull()
  })

  it('accepts a non-expired JWT', () => {
    const token = makeJWT(
      { sub: 'user_123', email: 'test@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET
    )
    expect(verifyHS256JWT(token, SECRET)).not.toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyHS256JWT('not.a.valid.jwt', SECRET)).toBeNull()
    expect(verifyHS256JWT('onlyone', SECRET)).toBeNull()
    expect(verifyHS256JWT('', SECRET)).toBeNull()
  })

  it('rejects non-HS256 algorithm', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: 'user_123' })).toString('base64url')
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    expect(verifyHS256JWT(`${header}.${body}.${sig}`, SECRET)).toBeNull()
  })

  it('extracts all standard claims', () => {
    const token = makeJWT(
      { sub: 'user_123', email: 'test@example.com', name: 'Jane', avatarURL: 'https://img.co/1' },
      SECRET
    )
    const result = verifyHS256JWT(token, SECRET)
    expect(result?.name).toBe('Jane')
    expect(result?.avatarURL).toBe('https://img.co/1')
  })

  it('supports id claim as alternative to sub', () => {
    const token = makeJWT({ id: 'user_456', email: 'test@example.com' }, SECRET)
    const result = verifyHS256JWT(token, SECRET)
    expect(result?.id).toBe('user_456')
  })

  it('detects tampered payload', () => {
    const token = makeJWT({ sub: 'user_123', email: 'test@example.com' }, SECRET)
    const parts = token.split('.')
    // Tamper with the payload
    const tampered = Buffer.from(
      JSON.stringify({ sub: 'hacker', email: 'evil@test.com' })
    ).toString('base64url')
    expect(verifyHS256JWT(`${parts[0]}.${tampered}.${parts[2]}`, SECRET)).toBeNull()
  })

  it('creates widget tokens that default subject to email', () => {
    const token = createWidgetIdentityToken({ email: 'test@example.com', name: 'Test' }, SECRET, 60)
    const result = verifyHS256JWT(token, SECRET)
    expect(result?.sub).toBe('test@example.com')
    expect(result?.id).toBe('test@example.com')
    expect(result?.email).toBe('test@example.com')
    expect(result?.name).toBe('Test')
  })
})
