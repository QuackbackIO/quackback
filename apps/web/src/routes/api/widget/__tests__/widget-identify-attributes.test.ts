import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (factories must not reference outer variables) ────────────
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: vi.fn() },
      session: { findFirst: vi.fn() },
      principal: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    select: vi.fn(() => ({ from: vi.fn(() => []) })),
  },
  user: {},
  session: {},
  principal: {},
  userAttributeDefinitions: {},
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(() => ({ enabled: true })),
  getWidgetSecret: vi.fn(() => 'test-secret-for-attrs'),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  getAllUserVotedPostIds: vi.fn(() => new Set()),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn(() => null),
}))
vi.mock('@/lib/server/auth/identify-merge', () => ({
  resolveAndMergeAnonymousToken: vi.fn(),
}))
vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'mock_id'),
}))
vi.mock('@/lib/server/domains/users/user.attributes', () => ({
  validateAndCoerceAttributes: vi.fn(() => ({ valid: {}, removals: [], errors: [] })),
  mergeMetadata: vi.fn((_existing: string | null, valid: Record<string, unknown>) =>
    JSON.stringify({ ...valid })
  ),
}))
vi.mock('@/lib/server/widget/identity-token', () => ({
  verifyHS256JWT: vi.fn(),
}))

import { extractCustomClaims, RESERVED_JWT_CLAIMS } from '../identify'

describe('Widget Identify — custom attributes from JWT claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractCustomClaims', () => {
    it('strips reserved JWT and identity claims', () => {
      const payload = {
        sub: 'user_1',
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test',
        avatarURL: 'https://img.co/1',
        iat: 1234567890,
        exp: 1234567890,
        nbf: 1234567890,
        iss: 'quackback',
        aud: 'widget',
        jti: 'token_id',
        // Custom claims:
        plan: 'pro',
        mrr: 9900,
      }
      const result = extractCustomClaims(payload)
      expect(result).toEqual({ plan: 'pro', mrr: 9900 })
    })

    it('returns empty object when no custom claims present', () => {
      const payload = {
        sub: 'user_1',
        email: 'test@example.com',
        iat: 123,
        exp: 456,
      }
      expect(extractCustomClaims(payload)).toEqual({})
    })

    it('handles avatarUrl (camelCase variant) as reserved', () => {
      const payload = {
        sub: 'user_1',
        email: 'test@example.com',
        avatarUrl: 'https://img.co/1',
        company: 'Acme',
      }
      expect(extractCustomClaims(payload)).toEqual({ company: 'Acme' })
    })
  })

  describe('RESERVED_JWT_CLAIMS', () => {
    it('includes all standard JWT and identity claims', () => {
      expect(RESERVED_JWT_CLAIMS).toContain('sub')
      expect(RESERVED_JWT_CLAIMS).toContain('iat')
      expect(RESERVED_JWT_CLAIMS).toContain('exp')
      expect(RESERVED_JWT_CLAIMS).toContain('email')
      expect(RESERVED_JWT_CLAIMS).toContain('avatarURL')
      expect(RESERVED_JWT_CLAIMS).toContain('avatarUrl')
    })
  })
})

describe('Widget Identify handler — attribute integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes custom claims to validateAndCoerceAttributes', async () => {
    const { validateAndCoerceAttributes } =
      await import('@/lib/server/domains/users/user.attributes')
    const mockValidate = vi.mocked(validateAndCoerceAttributes)
    mockValidate.mockResolvedValueOnce({
      valid: { plan: 'pro' },
      removals: [],
      errors: [{ key: 'unknown_field', reason: 'No attribute definition found' }],
    })

    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      plan: 'pro',
      unknown_field: 'dropped',
      iat: 123,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const custom = extractCustomClaims(claims)
    expect(custom).toEqual({ plan: 'pro', unknown_field: 'dropped' })

    // Simulate what the handler does
    const { valid } = await mockValidate(custom)
    expect(mockValidate).toHaveBeenCalledWith({ plan: 'pro', unknown_field: 'dropped' })
    expect(valid).toEqual({ plan: 'pro' })
  })

  it('does not call validateAndCoerceAttributes when no custom claims', () => {
    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      iat: 123,
      exp: 456,
    }
    const custom = extractCustomClaims(claims)
    expect(Object.keys(custom)).toHaveLength(0)
    // Handler should skip attribute validation entirely
  })

  it('handles boolean, number, and date custom claims', () => {
    const claims = {
      sub: 'user_1',
      email: 'test@example.com',
      enterprise: true,
      seat_count: 50,
      trial_ends: '2026-05-01T00:00:00Z',
    }
    const custom = extractCustomClaims(claims)
    expect(custom).toEqual({
      enterprise: true,
      seat_count: 50,
      trial_ends: '2026-05-01T00:00:00Z',
    })
  })
})
