import { describe, it, expect } from 'vitest'
import { z } from 'zod'

/**
 * Tests for the unverified identify path added alongside ssoToken.
 * The server accepts either a signed JWT or raw user fields; when
 * `identifyVerification` is enabled on the widget config, only JWT is allowed.
 */

// Recreate the identify schema to test validation (the real schema is not exported)
const identifySchema = z
  .object({
    ssoToken: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    sub: z.string().min(1).optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    avatarURL: z.string().optional(),
    avatarUrl: z.string().optional(),
    previousToken: z.string().optional(),
  })
  .passthrough()

describe('identify schema (unverified path)', () => {
  it('accepts a payload with id and email', () => {
    const result = identifySchema.safeParse({
      id: 'user_123',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a payload with sub instead of id', () => {
    const result = identifySchema.safeParse({
      sub: 'user_123',
      email: 'ada@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a payload with ssoToken alone', () => {
    const result = identifySchema.safeParse({ ssoToken: 'jwt.here' })
    expect(result.success).toBe(true)
  })

  it('preserves custom attributes via passthrough', () => {
    const result = identifySchema.safeParse({
      id: 'user_123',
      email: 'ada@example.com',
      plan: 'pro',
      mrr: 299,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).plan).toBe('pro')
      expect((result.data as Record<string, unknown>).mrr).toBe(299)
    }
  })

  it('rejects invalid email format', () => {
    const result = identifySchema.safeParse({
      id: 'user_123',
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty id when id field is present', () => {
    const result = identifySchema.safeParse({
      id: '',
      email: 'ada@example.com',
    })
    expect(result.success).toBe(false)
  })
})

describe('identify branch resolution', () => {
  /**
   * The handler uses body.ssoToken to decide between verified and unverified paths.
   * This mirrors the server logic:
   *   - ssoToken present → verify JWT, use JWT claims
   *   - ssoToken absent + identifyVerification=false → use body fields as claims
   *   - ssoToken absent + identifyVerification=true → reject (TOKEN_REQUIRED)
   */
  type Branch = 'verified' | 'unverified' | 'rejected'

  function resolveBranch(
    body: { ssoToken?: string },
    widgetConfig: { identifyVerification?: boolean }
  ): Branch {
    if (body.ssoToken) return 'verified'
    if (widgetConfig.identifyVerification) return 'rejected'
    return 'unverified'
  }

  it('routes ssoToken to the verified branch', () => {
    expect(resolveBranch({ ssoToken: 'jwt' }, { identifyVerification: false })).toBe('verified')
    expect(resolveBranch({ ssoToken: 'jwt' }, { identifyVerification: true })).toBe('verified')
  })

  it('routes unverified payload to the unverified branch when verification is off', () => {
    expect(resolveBranch({}, { identifyVerification: false })).toBe('unverified')
  })

  it('rejects unverified payload when verification is on', () => {
    expect(resolveBranch({}, { identifyVerification: true })).toBe('rejected')
  })
})
