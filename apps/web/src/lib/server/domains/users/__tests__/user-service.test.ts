/**
 * Tests for user service functions.
 *
 * Covers:
 * - parseUserAttributes: metadata JSON parsing with internal key stripping
 * - validateAndCoerceAttributes: attribute validation against definitions (mocked DB)
 * - identifyPortalUser: upsert by email (mocked DB)
 * - updatePortalUser: update existing user (mocked DB)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

// --- Mock tracking ---

const insertValuesCalls: unknown[] = []
const updateSetCalls: unknown[] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'user_new123' as UserId,
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      emailVerified: false,
      metadata: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ])
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockResolvedValue([])
  return chain
}

const mockFindFirst = vi.fn()
const mockSelectFrom = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
      principal: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'principal_abc' as PrincipalId,
        }),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    })),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(),
  principal: { id: 'id', userId: 'user_id', role: 'role' },
  user: {
    id: 'id',
    name: 'name',
    email: 'email',
    image: 'image',
    emailVerified: 'email_verified',
    metadata: 'metadata',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  posts: {},
  comments: {},
  votes: {},
  postStatuses: {},
  boards: {},
  userSegments: {},
  segments: {},
  userAttributeDefinitions: 'user_attribute_definitions',
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_generated123`),
}))

vi.mock('@/lib/shared/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  ValidationError: class ValidationError extends Error {
    code: string
    cause: unknown
    constructor(code: string, message: string, cause?: unknown) {
      super(message)
      this.code = code
      this.cause = cause
    }
  },
  InternalError: class InternalError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

describe('user.service', () => {
  beforeEach(() => {
    insertValuesCalls.length = 0
    updateSetCalls.length = 0
    vi.clearAllMocks()
  })

  // ============================================
  // parseUserAttributes
  // ============================================

  describe('parseUserAttributes', () => {
    it('should parse valid JSON metadata', async () => {
      const { parseUserAttributes } = await import('../user.service')
      const result = parseUserAttributes('{"plan":"enterprise","mrr":500}')
      expect(result).toEqual({ plan: 'enterprise', mrr: 500 })
    })

    it('should return empty object for null', async () => {
      const { parseUserAttributes } = await import('../user.service')
      expect(parseUserAttributes(null)).toEqual({})
    })

    it('should return empty object for invalid JSON', async () => {
      const { parseUserAttributes } = await import('../user.service')
      expect(parseUserAttributes('not-json')).toEqual({})
    })

    it('should return empty object for empty string', async () => {
      const { parseUserAttributes } = await import('../user.service')
      expect(parseUserAttributes('')).toEqual({})
    })

    it('should strip internal keys prefixed with _', async () => {
      const { parseUserAttributes } = await import('../user.service')
      const result = parseUserAttributes(
        '{"plan":"pro","_externalUserId":"ext123","_internal":"secret"}'
      )
      expect(result).toEqual({ plan: 'pro' })
      expect(result).not.toHaveProperty('_externalUserId')
      expect(result).not.toHaveProperty('_internal')
    })

    it('should return only public keys when metadata has only internal keys', async () => {
      const { parseUserAttributes } = await import('../user.service')
      const result = parseUserAttributes('{"_externalUserId":"ext123"}')
      expect(result).toEqual({})
    })
  })

  // ============================================
  // validateAndCoerceAttributes
  // ============================================

  describe('validateAndCoerceAttributes', () => {
    it('should validate attributes against definitions', async () => {
      // Mock attribute definitions
      mockSelectFrom.mockResolvedValueOnce([
        { key: 'plan', type: 'string', externalKey: null },
        { key: 'mrr', type: 'number', externalKey: null },
      ])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ plan: 'enterprise', mrr: '500' })

      expect(result.valid).toEqual({ plan: 'enterprise', mrr: 500 })
      expect(result.errors).toEqual([])
      expect(result.removals).toEqual([])
    })

    it('should report errors for unknown attribute keys', async () => {
      mockSelectFrom.mockResolvedValueOnce([{ key: 'plan', type: 'string', externalKey: null }])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ plan: 'pro', unknown_key: 'value' })

      expect(result.valid).toEqual({ plan: 'pro' })
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].key).toBe('unknown_key')
    })

    it('should handle null values as removals', async () => {
      mockSelectFrom.mockResolvedValueOnce([{ key: 'plan', type: 'string', externalKey: null }])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ plan: null })

      expect(result.removals).toEqual(['plan'])
      expect(result.valid).toEqual({})
    })

    it('should report errors for values that cannot be coerced', async () => {
      mockSelectFrom.mockResolvedValueOnce([{ key: 'mrr', type: 'number', externalKey: null }])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ mrr: 'not-a-number' })

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].key).toBe('mrr')
      expect(result.errors[0].reason).toContain('cannot be coerced')
    })

    it('should coerce boolean strings', async () => {
      mockSelectFrom.mockResolvedValueOnce([{ key: 'active', type: 'boolean', externalKey: null }])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ active: 'true' })

      expect(result.valid).toEqual({ active: true })
    })

    it('should coerce date values to ISO strings', async () => {
      mockSelectFrom.mockResolvedValueOnce([
        { key: 'signup_date', type: 'date', externalKey: null },
      ])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ signup_date: '2024-06-15T00:00:00Z' })

      expect(result.valid.signup_date).toBe('2024-06-15T00:00:00.000Z')
    })

    it('should return empty results when no definitions exist', async () => {
      mockSelectFrom.mockResolvedValueOnce([])

      const { validateAndCoerceAttributes } = await import('../user.service')
      const result = await validateAndCoerceAttributes({ plan: 'pro' })

      expect(result.valid).toEqual({})
      expect(result.errors).toHaveLength(1) // "No attribute definition found"
    })
  })

  // ============================================
  // identifyPortalUser
  // ============================================

  describe('identifyPortalUser', () => {
    it('should store externalId as _externalUserId in metadata for new users', async () => {
      // No existing user
      mockFindFirst.mockResolvedValueOnce(undefined)

      const { identifyPortalUser } = await import('../user.service')
      await identifyPortalUser({
        email: 'new@example.com',
        externalId: 'ext-new',
      })

      // First insert is for the user table
      expect(insertValuesCalls.length).toBeGreaterThanOrEqual(1)
      const userInsert = insertValuesCalls[0][0] as Record<string, unknown>
      const metadata = JSON.parse(userInsert.metadata as string)
      expect(metadata._externalUserId).toBe('ext-new')
    })

    it('should set metadata to null when no externalId or attributes', async () => {
      mockFindFirst.mockResolvedValueOnce(undefined)

      const { identifyPortalUser } = await import('../user.service')
      await identifyPortalUser({ email: 'plain@example.com' })

      const userInsert = insertValuesCalls[0][0] as Record<string, unknown>
      expect(userInsert.metadata).toBeNull()
    })

    it('should add externalId to existing user metadata', async () => {
      const existingUser = {
        id: 'user_existing' as UserId,
        name: 'Existing User',
        email: 'existing@example.com',
        image: null,
        emailVerified: false,
        metadata: JSON.stringify({ plan: 'pro' }),
        createdAt: new Date('2024-01-01'),
      }

      // Find existing user, then re-read after update
      mockFindFirst.mockResolvedValueOnce(existingUser).mockResolvedValueOnce(existingUser)

      const { identifyPortalUser } = await import('../user.service')
      await identifyPortalUser({
        email: 'existing@example.com',
        externalId: 'ext-456',
      })

      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      const metadata = JSON.parse(setArgs.metadata as string)
      expect(metadata._externalUserId).toBe('ext-456')
      expect(metadata.plan).toBe('pro')
    })

    it('should preserve _externalUserId when updating only attributes', async () => {
      const existingUser = {
        id: 'user_existing' as UserId,
        name: 'Existing User',
        email: 'existing@example.com',
        image: null,
        emailVerified: false,
        metadata: JSON.stringify({ plan: 'pro', _externalUserId: 'ext-789' }),
        createdAt: new Date('2024-01-01'),
      }

      // Attribute definitions for 'plan'
      mockSelectFrom.mockResolvedValueOnce([{ key: 'plan', type: 'string', externalKey: null }])
      // Find existing user, then re-read after update
      mockFindFirst.mockResolvedValueOnce(existingUser).mockResolvedValueOnce(existingUser)

      const { identifyPortalUser } = await import('../user.service')
      await identifyPortalUser({
        email: 'existing@example.com',
        attributes: { plan: 'enterprise' },
      })

      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      const metadata = JSON.parse(setArgs.metadata as string)
      expect(metadata.plan).toBe('enterprise')
      expect(metadata._externalUserId).toBe('ext-789') // must be preserved
    })

    it('should remove _externalUserId when externalId is set to null', async () => {
      const existingUser = {
        id: 'user_existing' as UserId,
        name: 'Existing User',
        email: 'existing@example.com',
        image: null,
        emailVerified: false,
        metadata: JSON.stringify({ plan: 'pro', _externalUserId: 'ext-to-remove' }),
        createdAt: new Date('2024-01-01'),
      }

      // Find existing user, then re-read after update
      mockFindFirst.mockResolvedValueOnce(existingUser).mockResolvedValueOnce(existingUser)

      const { identifyPortalUser } = await import('../user.service')
      await identifyPortalUser({
        email: 'existing@example.com',
        externalId: null,
      })

      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      const metadata = JSON.parse(setArgs.metadata as string)
      expect(metadata.plan).toBe('pro')
      expect(metadata).not.toHaveProperty('_externalUserId')
    })
  })
})
