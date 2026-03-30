import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'crypto'

// Mock the DB and settings imports so the module can load
vi.mock('@/lib/server/db', () => ({
  db: { query: {}, insert: vi.fn(), update: vi.fn() },
  user: {},
  session: {},
  principal: {},
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(),
  getWidgetSecret: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  getAllUserVotedPostIds: vi.fn(),
}))
vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'mock_id'),
}))

import { verifyHS256JWT } from '../identify'

const SECRET = 'test-secret-key-for-jwt'

function createJWT(payload: Record<string, unknown>, secret: string, alg = 'HS256'): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

describe('verifyHS256JWT', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('verifies a valid JWT and returns the payload', () => {
    const payload = { sub: 'user_123', email: 'jane@test.com', name: 'Jane' }
    const token = createJWT(payload, SECRET)
    const result = verifyHS256JWT(token, SECRET)
    expect(result).toEqual(payload)
  })

  it('returns null for wrong secret', () => {
    const token = createJWT({ sub: 'user_123' }, SECRET)
    expect(verifyHS256JWT(token, 'wrong-secret')).toBeNull()
  })

  it('returns null for malformed token (not 3 parts)', () => {
    expect(verifyHS256JWT('only.two', SECRET)).toBeNull()
    expect(verifyHS256JWT('one', SECRET)).toBeNull()
    expect(verifyHS256JWT('', SECRET)).toBeNull()
    expect(verifyHS256JWT('a.b.c.d', SECRET)).toBeNull()
  })

  it('returns null for non-HS256 algorithm', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ sub: 'test' })).toString('base64url')
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    expect(verifyHS256JWT(`${header}.${body}.${sig}`, SECRET)).toBeNull()
  })

  it('returns null for expired token', () => {
    const payload = { sub: 'user_123', exp: Math.floor(Date.now() / 1000) - 60 }
    const token = createJWT(payload, SECRET)
    expect(verifyHS256JWT(token, SECRET)).toBeNull()
  })

  it('accepts token without exp claim', () => {
    const payload = { sub: 'user_123', email: 'test@test.com' }
    const token = createJWT(payload, SECRET)
    expect(verifyHS256JWT(token, SECRET)).toEqual(payload)
  })

  it('accepts token with future exp', () => {
    const payload = { sub: 'user_123', exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = createJWT(payload, SECRET)
    const result = verifyHS256JWT(token, SECRET)
    expect(result?.sub).toBe('user_123')
  })

  it('returns null for tampered payload', () => {
    const token = createJWT({ sub: 'user_123' }, SECRET)
    const parts = token.split('.')
    // Tamper the payload
    const tampered = Buffer.from(JSON.stringify({ sub: 'hacker' })).toString('base64url')
    expect(verifyHS256JWT(`${parts[0]}.${tampered}.${parts[2]}`, SECRET)).toBeNull()
  })

  it('returns null for tampered signature', () => {
    const token = createJWT({ sub: 'user_123' }, SECRET)
    const parts = token.split('.')
    expect(verifyHS256JWT(`${parts[0]}.${parts[1]}.invalid_signature`, SECRET)).toBeNull()
  })

  it('returns null for invalid base64url in header', () => {
    expect(verifyHS256JWT('!!!.body.sig', SECRET)).toBeNull()
  })

  it('returns null for invalid JSON in payload', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const body = Buffer.from('not json').toString('base64url')
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    expect(verifyHS256JWT(`${header}.${body}.${sig}`, SECRET)).toBeNull()
  })

  it('preserves all payload claims', () => {
    const payload = {
      sub: 'user_123',
      email: 'jane@test.com',
      name: 'Jane Doe',
      avatarURL: 'https://example.com/avatar.png',
      custom: 'value',
    }
    const token = createJWT(payload, SECRET)
    expect(verifyHS256JWT(token, SECRET)).toEqual(payload)
  })
})
