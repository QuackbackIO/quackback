/**
 * consumeRecoveryCodeFn — public sign-in path that verifies a recovery
 * code, marks it used, and returns a magic-link verify URL the caller
 * can redirect to. Constant-time verify, generic error on unknown email
 * (no enumeration), audit on both success and failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  recordAuditEvent: vi.fn(),
  hashRecoveryCode: vi.fn(),
  verifyRecoveryCode: vi.fn(),
  mintMagicLinkUrl: vi.fn(),
  findUser: vi.fn(),
  findCodes: vi.fn(),
  updateUsedFn: vi.fn(),
  setStub: vi.fn(),
  whereStub: vi.fn(),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers({ 'x-forwarded-for': '203.0.113.45', 'user-agent': 'test-agent' }),
}))

vi.mock('@/lib/server/auth/recovery-codes', () => ({
  verifyRecoveryCode: hoisted.verifyRecoveryCode,
  hashRecoveryCode: hoisted.hashRecoveryCode,
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: hoisted.mintMagicLinkUrl,
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.quackback.io' },
}))

// Stub Redis: the consume fn rate-limits via INCR + EXPIRE. We don't
// care about the rate-limit branch in these tests — return a stable
// "allowed" count and the helper's `count > limit` check stays
// false.
vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    multi: () => ({
      incr: () => undefined,
      expire: () => undefined,
      exec: async () => [
        [null, 1],
        [null, 1],
      ],
    }),
    ttl: async () => 300,
  }),
  cacheDel: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  CACHE_KEYS: {},
}))

// Stub email so the fire-and-forget alert doesn't try to load real
// SMTP / Resend bindings during the test.
vi.mock('@quackback/email', () => ({
  sendRecoveryCodeUsedEmail: vi.fn().mockResolvedValue({ sent: true }),
  isEmailConfigured: () => false,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: hoisted.findUser },
      ssoRecoveryCode: { findMany: hoisted.findCodes },
    },
    update: (...a: unknown[]) => hoisted.updateUsedFn(...a),
  },
  user: { id: 'user.id', email: 'user.email' },
  ssoRecoveryCode: {
    id: 'rcode.id',
    userId: 'rcode.userId',
    codeHash: 'rcode.codeHash',
    usedAt: 'rcode.usedAt',
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  and: vi.fn((...p: unknown[]) => ({ op: 'and', p })),
  isNull: vi.fn((col: unknown) => ({ op: 'isnull', col })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.updateUsedFn.mockReturnValue({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  })
  hoisted.findUser.mockResolvedValue(null)
  hoisted.findCodes.mockResolvedValue([])
  hoisted.verifyRecoveryCode.mockResolvedValue(false)
  hoisted.mintMagicLinkUrl.mockResolvedValue('https://acme.quackback.io/verify-magic-link?token=t')
})

await import('../recovery-codes-consume')
const consumeRecoveryCode = handlers[0]

describe('consumeRecoveryCodeFn', () => {
  it('returns a generic error when email is unknown — no enumeration leak', async () => {
    hoisted.findUser.mockResolvedValue(null)

    const result = (await consumeRecoveryCode({
      data: { email: 'unknown@example.com', code: 'ABCD-EFGH-JKMN' },
    })) as { ok: boolean; error?: string }

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('returns a generic error when no active code matches', async () => {
    hoisted.findUser.mockResolvedValue({ id: 'user_1', email: 'admin@example.com' })
    hoisted.findCodes.mockResolvedValue([
      { id: 'rcode_1', codeHash: 'hash1' },
      { id: 'rcode_2', codeHash: 'hash2' },
    ])
    hoisted.verifyRecoveryCode.mockResolvedValue(false)

    const result = (await consumeRecoveryCode({
      data: { email: 'admin@example.com', code: 'BAD-CODE-XXXX' },
    })) as { ok: boolean; error?: string }

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('marks the matching code used_at and mints a magic-link verify URL on success', async () => {
    hoisted.findUser.mockResolvedValue({ id: 'user_1', email: 'admin@example.com' })
    hoisted.findCodes.mockResolvedValue([
      { id: 'rcode_1', codeHash: 'hash1' },
      { id: 'rcode_2', codeHash: 'hash2' },
    ])
    // First code rejects, second matches.
    hoisted.verifyRecoveryCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = (await consumeRecoveryCode({
      data: { email: 'admin@example.com', code: 'ABCD-EFGH-JKMN' },
    })) as { ok: boolean; redirectUrl?: string }

    expect(result.ok).toBe(true)
    expect(result.redirectUrl).toContain('verify-magic-link')

    expect(hoisted.updateUsedFn).toHaveBeenCalled()
    expect(hoisted.mintMagicLinkUrl).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@example.com' })
    )
  })

  it('emits sso.recovery_codes.used on success', async () => {
    hoisted.findUser.mockResolvedValue({ id: 'user_1', email: 'admin@example.com' })
    hoisted.findCodes.mockResolvedValue([{ id: 'rcode_1', codeHash: 'h' }])
    hoisted.verifyRecoveryCode.mockResolvedValue(true)

    await consumeRecoveryCode({
      data: { email: 'admin@example.com', code: 'ABCD-EFGH-JKMN' },
    })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sso.recovery_codes.used',
        outcome: 'success',
      })
    )
  })

  it('emits auth.method.blocked on failure', async () => {
    hoisted.findUser.mockResolvedValue({ id: 'user_1', email: 'admin@example.com' })
    hoisted.findCodes.mockResolvedValue([{ id: 'rcode_1', codeHash: 'h' }])
    hoisted.verifyRecoveryCode.mockResolvedValue(false)

    await consumeRecoveryCode({
      data: { email: 'admin@example.com', code: 'BAD-CODE-XXXX' },
    })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.method.blocked',
        outcome: 'failure',
      })
    )
  })

  it('performs at least one verify call even when email is unknown (constant-time)', async () => {
    hoisted.findUser.mockResolvedValue(null)

    await consumeRecoveryCode({
      data: { email: 'unknown@example.com', code: 'ABCD-EFGH-JKMN' },
    })

    // To equalise timing, the handler should still perform a verify
    // computation even when the user doesn't exist. This is the
    // "fake hash compare" mitigation against email-enumeration timing
    // oracles.
    expect(hoisted.verifyRecoveryCode).toHaveBeenCalled()
  })

  it('rate-limits and returns invalid_credentials when the per-IP+email window is exhausted', async () => {
    // Reload the consume module with a redis mock that reports a
    // count above the 5-per-5-min threshold. The handler then short-
    // circuits before any DB / scrypt work and returns rate_limited.
    vi.resetModules()
    vi.doMock('@/lib/server/redis', () => ({
      getRedis: () => ({
        multi: () => ({
          incr: () => undefined,
          expire: () => undefined,
          exec: async () => [
            [null, 99], // INCR result far above the limit
            [null, 1],
          ],
        }),
        ttl: async () => 300,
      }),
      cacheDel: vi.fn(),
      cacheGet: vi.fn(),
      cacheSet: vi.fn(),
      CACHE_KEYS: {},
    }))

    // Re-import so the new redis mock is bound on this module's
    // closure. Other vi.mock() calls at the top of the file remain
    // in effect across the reset.
    const reloadedHandlers: AnyHandler[] = []
    vi.doMock('@tanstack/react-start', () => ({
      createServerFn: () => {
        const chain = {
          inputValidator() {
            return chain
          },
          handler(fn: AnyHandler) {
            reloadedHandlers.push(fn)
            return chain
          },
        }
        return chain
      },
    }))
    await import('../recovery-codes-consume')
    const reloaded = reloadedHandlers[0]

    const result = (await reloaded({
      data: { email: 'admin@example.com', code: 'ABCD-EFGH-JKMN' },
    })) as { ok: boolean; error?: string }

    expect(result).toEqual({ ok: false, error: 'rate_limited' })
    // Audit row records the rate-limit reason for forensic tracing.
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.method.blocked',
        outcome: 'failure',
        metadata: expect.objectContaining({ method: 'recovery_code', reason: 'rate_limited' }),
      })
    )
  })
})
