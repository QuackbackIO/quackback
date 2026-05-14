/**
 * Server functions for recovery codes.
 *
 *  - generateRecoveryCodesFn: admin-only, creates 10 fresh codes for
 *    the calling user, deletes any prior active codes, returns
 *    plaintext codes ONCE, emits sso.recovery_codes.generated audit
 *  - listRecoveryCodesFn: admin-only, returns metadata only (never
 *    plaintext or hash) scoped to the calling user
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
  requireAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
  insertReturning: vi.fn(),
  deleteWhere: vi.fn(),
  findMany: vi.fn(),
  insertFn: vi.fn(),
  deleteFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
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
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...a: unknown[]) => hoisted.insertFn(...a),
    delete: (...a: unknown[]) => hoisted.deleteFn(...a),
    query: {
      ssoRecoveryCode: {
        findMany: (...a: unknown[]) => hoisted.findMany(...a),
      },
    },
  },
  ssoRecoveryCode: {
    id: 'ssoRecoveryCode.id',
    userId: 'ssoRecoveryCode.userId',
    codeHash: 'ssoRecoveryCode.codeHash',
    usedAt: 'ssoRecoveryCode.usedAt',
    createdAt: 'ssoRecoveryCode.createdAt',
  },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ op: 'isnull', col })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.insertFn.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })
  hoisted.deleteFn.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  hoisted.findMany.mockResolvedValue([])
})

// Load module once — generate is index 0, list is index 1.
await import('../recovery-codes')
const generateRecoveryCodes = handlers[0]
const listRecoveryCodes = handlers[1]

describe('generateRecoveryCodesFn', () => {
  it('requires admin role', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(generateRecoveryCodes({ data: {} })).rejects.toThrow('Access denied')
  })

  it('returns exactly 10 plaintext codes in Crockford format', async () => {
    const result = (await generateRecoveryCodes({ data: {} })) as { codes: string[] }
    expect(result.codes).toHaveLength(10)
    for (const code of result.codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    }
  })

  it('deletes the prior active batch before inserting fresh codes', async () => {
    await generateRecoveryCodes({ data: {} })
    expect(hoisted.deleteFn).toHaveBeenCalled()
  })

  it('inserts 10 hashed rows for the calling admin', async () => {
    const inserts: unknown[] = []
    hoisted.insertFn.mockReturnValue({
      values: vi.fn((rows: unknown[]) => {
        inserts.push(rows)
        return Promise.resolve(undefined)
      }),
    })

    await generateRecoveryCodes({ data: {} })

    const rows = inserts[0] as Array<{ userId: string; codeHash: string }>
    expect(rows).toHaveLength(10)
    expect(rows.every((r) => r.userId === 'user_admin1')).toBe(true)
    // All hashes are different (different salts).
    expect(new Set(rows.map((r) => r.codeHash)).size).toBe(10)
  })

  it('emits sso.recovery_codes.generated audit event', async () => {
    await generateRecoveryCodes({ data: {} })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sso.recovery_codes.generated',
        outcome: 'success',
      })
    )
  })
})

describe('listRecoveryCodesFn', () => {
  it('requires admin role', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listRecoveryCodes({ data: {} })).rejects.toThrow('Access denied')
  })

  it('returns metadata only — no codeHash, no plaintext', async () => {
    hoisted.findMany.mockResolvedValue([
      {
        id: 'rcode_1',
        codeHash: 'secret-hash',
        usedAt: null,
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
      {
        id: 'rcode_2',
        codeHash: 'another-hash',
        usedAt: new Date('2026-05-11T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
    ])

    const result = (await listRecoveryCodes({ data: {} })) as {
      codes: Array<{ id: string; createdAt: string; usedAt: string | null }>
    }

    expect(result.codes).toHaveLength(2)
    for (const code of result.codes) {
      expect(code).not.toHaveProperty('codeHash')
    }
    expect(result.codes[0].usedAt).toBeNull()
    expect(result.codes[1].usedAt).toBe('2026-05-11T00:00:00.000Z')
  })
})
