import { describe, it, expect } from 'vitest'
import { z } from 'zod'

/**
 * Tests for the previousToken feature in the identify endpoint:
 * 1. Schema accepts previousToken field
 * 2. Ownership verification logic (Bearer must match previousToken)
 */

// Recreate the identify schema to test validation (the real schema is not exported)
const identifySchema = z
  .object({
    ssoToken: z.string().optional(),
    id: z.string().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    avatarURL: z.string().url().optional(),
    created: z.string().optional(),
    hash: z.string().optional(),
    previousToken: z.string().optional(),
  })
  .refine((data) => data.ssoToken || (data.id && data.email), {
    message: 'Either ssoToken or (id + email) is required',
  })

describe('identify endpoint previousToken', () => {
  describe('schema validation', () => {
    it('accepts payload with previousToken', () => {
      const result = identifySchema.safeParse({
        id: 'user_123',
        email: 'jane@acme.com',
        previousToken: 'old-session-token-uuid',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.previousToken).toBe('old-session-token-uuid')
      }
    })

    it('accepts payload without previousToken', () => {
      const result = identifySchema.safeParse({
        id: 'user_123',
        email: 'jane@acme.com',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.previousToken).toBeUndefined()
      }
    })

    it('accepts ssoToken with previousToken', () => {
      const result = identifySchema.safeParse({
        ssoToken: 'jwt.token.here',
        previousToken: 'old-session-token',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('ownership verification', () => {
    /**
     * The identify endpoint checks that the Bearer header matches the
     * previousToken body field before triggering a merge. This prevents
     * arbitrary anonymous session tokens from being merged into any account.
     */
    function extractBearerToken(authHeader: string | null): string | null {
      if (!authHeader?.startsWith('Bearer ')) return null
      return authHeader.slice(7) || null
    }

    function shouldMerge(bearerToken: string | null, previousToken: string | undefined): boolean {
      if (!previousToken) return false
      return !!bearerToken && bearerToken === previousToken
    }

    it('allows merge when Bearer matches previousToken', () => {
      const bearer = extractBearerToken('Bearer session-token-abc')
      expect(shouldMerge(bearer, 'session-token-abc')).toBe(true)
    })

    it('blocks merge when Bearer does not match previousToken', () => {
      const bearer = extractBearerToken('Bearer different-token')
      expect(shouldMerge(bearer, 'session-token-abc')).toBe(false)
    })

    it('blocks merge when no Bearer header present', () => {
      const bearer = extractBearerToken(null)
      expect(shouldMerge(bearer, 'session-token-abc')).toBe(false)
    })

    it('blocks merge when no previousToken in body', () => {
      const bearer = extractBearerToken('Bearer session-token-abc')
      expect(shouldMerge(bearer, undefined)).toBe(false)
    })

    it('blocks merge when Bearer is empty', () => {
      const bearer = extractBearerToken('Bearer ')
      expect(shouldMerge(bearer, 'session-token-abc')).toBe(false)
    })

    it('blocks merge when Authorization is not Bearer scheme', () => {
      const bearer = extractBearerToken('Basic abc123')
      expect(shouldMerge(bearer, 'session-token-abc')).toBe(false)
    })
  })
})
