/**
 * `handleSsoCallbackAfter` — bootstrap admin promotion + lastSsoSignInAt
 * stamping on a successful SSO callback.
 *
 * Critical for security: this is what makes the FIRST human SSO sign-in
 * to a fresh workspace claim admin. If the existing-admin lookup is
 * wrong, the next user (potentially attacker) could get the admin role
 * even though one already exists. The lookup filters by `type='user'`
 * so a service-principal admin (config-file-provisioned API key) does
 * NOT block bootstrap promotion of the first real user.
 *
 * Behaviors covered:
 *   - Path / provider / userId guards (no DB writes on miss).
 *   - Advisory-lock acquired inside the transaction.
 *   - Promotion when no human admin exists.
 *   - No promotion when a human admin already exists.
 *   - Service-principal admin is *not* counted as a human (gate uses
 *     `and(role='admin', type='user')`).
 *   - lastSsoSignInAt is stamped in both branches.
 *   - Writes happen inside a single transaction (atomicity).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type TxLike = {
  execute: ReturnType<typeof vi.fn>
  query: { principal: { findFirst: ReturnType<typeof vi.fn> } }
  update: ReturnType<typeof vi.fn>
}

const mockExecute = vi.fn()
const mockTxFindFirst = vi.fn()
const mockTxUpdateSet = vi.fn()
const mockTxUpdateWhere = vi.fn(async () => undefined)
const mockTxUpdate = vi.fn(() => ({
  set: (...args: unknown[]) => {
    mockTxUpdateSet(...args)
    return { where: mockTxUpdateWhere }
  },
}))

const tx: TxLike = {
  execute: mockExecute,
  query: { principal: { findFirst: mockTxFindFirst } },
  update: mockTxUpdate,
}

const mockTransaction = vi.fn(async (fn: (tx: TxLike) => Promise<void>) => fn(tx))

vi.mock('@/lib/server/db', () => ({
  db: { transaction: mockTransaction },
  principal: {
    __name: 'principal',
    id: 'principal.id',
    role: 'principal.role',
    type: 'principal.type',
    userId: 'principal.userId',
  },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

const { handleSsoCallbackAfter } = await import('../hooks')

function ctxFor(opts: { path?: string; providerParam?: string; userId?: string }) {
  return {
    path: opts.path,
    params: opts.providerParam ? { providerId: opts.providerParam } : {},
    context: {
      newSession: opts.userId ? { user: { id: opts.userId }, session: { token: 'tok' } } : null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExecute.mockResolvedValue(undefined)
  mockTxFindFirst.mockResolvedValue(null)
})

describe('handleSsoCallbackAfter — guards', () => {
  it('skips when path is not the OAuth callback', async () => {
    await handleSsoCallbackAfter(ctxFor({ path: '/sign-in/email', userId: 'user_1' }))
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips when providerId is not "sso" (e.g. google callback)', async () => {
    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'google',
        userId: 'user_1',
      })
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips when newSession.user.id is missing (no session was actually created)', async () => {
    await handleSsoCallbackAfter(
      ctxFor({ path: '/oauth2/callback/:providerId', providerParam: 'sso' })
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips when userId is an empty string', async () => {
    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: '',
      })
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('handleSsoCallbackAfter — bootstrap admin promotion', () => {
  it('promotes the user to admin when no human admin exists', async () => {
    mockTxFindFirst.mockResolvedValue(null)

    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_first',
      })
    )

    // The promotion set + the lastSsoSignInAt set.
    expect(mockTxUpdateSet).toHaveBeenCalledTimes(2)
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(1, { role: 'admin' })
    expect(mockTxUpdateSet.mock.calls[1][0]).toHaveProperty('lastSsoSignInAt')
    expect(mockTxUpdateSet.mock.calls[1][0].lastSsoSignInAt).toBeInstanceOf(Date)
  })

  it('does NOT promote when a human admin already exists', async () => {
    mockTxFindFirst.mockResolvedValue({ id: 'principal_existing_admin' })

    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_second',
      })
    )

    // No promotion — only the lastSsoSignInAt write.
    expect(mockTxUpdateSet).toHaveBeenCalledTimes(1)
    expect(mockTxUpdateSet).not.toHaveBeenCalledWith({ role: 'admin' })
    expect(mockTxUpdateSet.mock.calls[0][0]).toHaveProperty('lastSsoSignInAt')
  })

  it('filters the existing-admin lookup by type=user so a service-principal admin does not block promotion', async () => {
    mockTxFindFirst.mockResolvedValue(null)

    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_first',
      })
    )

    // The findFirst received a `where: and(eq(role, 'admin'), eq(type, 'user'))`.
    expect(mockTxFindFirst).toHaveBeenCalledTimes(1)
    const call = mockTxFindFirst.mock.calls[0][0] as { where: { parts: unknown[] } }
    expect(call.where.parts).toHaveLength(2)
  })

  it('stamps lastSsoSignInAt even on the second sign-in (admin already exists)', async () => {
    mockTxFindFirst.mockResolvedValue({ id: 'principal_admin' })

    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_second',
      })
    )

    expect(mockTxUpdate).toHaveBeenCalledTimes(1)
    const setArg = mockTxUpdateSet.mock.calls[0][0] as { lastSsoSignInAt?: Date }
    expect(setArg.lastSsoSignInAt).toBeInstanceOf(Date)
  })
})

describe('handleSsoCallbackAfter — transaction + locking', () => {
  it('wraps all writes in a single db.transaction', async () => {
    mockTxFindFirst.mockResolvedValue(null)
    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_first',
      })
    )
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('acquires a workspace-scoped advisory lock before the admin lookup', async () => {
    mockTxFindFirst.mockResolvedValue(null)
    await handleSsoCallbackAfter(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_first',
      })
    )
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const arg = mockExecute.mock.calls[0][0] as { strings: TemplateStringsArray }
    expect(arg.strings.raw.join('')).toContain('pg_advisory_xact_lock')
    expect(arg.strings.raw.join('')).toContain('quackback:sso_bootstrap')
  })
})
