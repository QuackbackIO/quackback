/**
 * Coverage for the last-admin invariant in setPrincipalRole
 * (principal.factory.ts, ~lines 209-246): demoting/removing a user-type
 * admin acquires `pg_advisory_xact_lock`, counts OTHER user-type admins
 * (excluding the target), and throws ForbiddenError('LAST_ADMIN') at zero.
 *
 * ## Split of coverage between this suite and the .db sibling
 *
 * This mocked suite exercises the guard's BRANCHING LOGIC — lock before
 * count, count-excluding-self by principalId/userId, throw-at-zero,
 * proceed-above-zero, skip for non-admins/service principals/promotions —
 * against a mocked `db`, so it stays fast and deterministic regardless of
 * what admins the test database already holds.
 *
 * The exclusion predicate must compare the uuid-storage id/userId column
 * against the caller's branded TypeID ref through the column's typed
 * mapping (`ne(principal.id, ...)`), NOT a raw `sql` fragment that would
 * hand Postgres the branded string and get "invalid input syntax for type
 * uuid". That coercion is a real-column concern a mock cannot see, so its
 * regression guard lives in the real-Postgres sibling
 * `last-admin-invariant.db.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'
import { ForbiddenError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockFindFirst: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockCacheDel: vi.fn(),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: hoisted.mockCacheDel,
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  // Same shape whether called as the top-level `db` or the `tx` handle
  // passed into the transaction callback — setPrincipalRole treats both
  // identically via the `Executor` union.
  function buildExecutor() {
    return {
      execute: hoisted.mockExecute,
      query: { principal: { findFirst: hoisted.mockFindFirst } },
      select: () => ({ from: () => ({ where: hoisted.mockSelectWhere }) }),
      update: () => ({
        set: (arg: unknown) => {
          hoisted.mockUpdateSet(arg)
          return { where: (...args: unknown[]) => hoisted.mockUpdateWhere(...args) }
        },
      }),
    }
  }

  const exec = buildExecutor()

  return {
    db: {
      ...exec,
      transaction: async (fn: (tx: ReturnType<typeof buildExecutor>) => Promise<unknown>) =>
        fn(buildExecutor()),
    },
    // Plain identifier stand-ins (mirrors seat-limit.test.ts) — the mocked
    // select/query above ignore the built predicate's shape entirely, so
    // these only need to exist for `eq`/`and`/`sql` to interpolate.
    principal: { id: 'pid', role: 'role', type: 'type', userId: 'userId' },
    eq: drizzle.eq,
    ne: drizzle.ne,
    and: drizzle.and,
    sql: drizzle.sql,
  }
})

import { setPrincipalRole } from '../principal.factory'

const TARGET_PRINCIPAL_ID = 'principal_target_admin' as PrincipalId
const TARGET_USER_ID = 'user_target_admin' as UserId
const OWNING_USER_ID = 'user_owner' as UserId

describe('setPrincipalRole — last-admin invariant (guard branching)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockExecute.mockResolvedValue(undefined)
    hoisted.mockUpdateWhere.mockResolvedValue(undefined)
    // Every call in this suite targets a currently-admin, type='user'
    // principal, and resolveUserId's post-write lookup reuses the same
    // mock — give it both fields so either read is satisfied.
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'user',
      role: 'admin',
      userId: OWNING_USER_ID,
    })
  })

  it('throws LAST_ADMIN and does not write the role when zero other admins exist', async () => {
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 0 }])

    await expect(
      setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' })

    expect(hoisted.mockUpdateSet).not.toHaveBeenCalled()
  })

  it('proceeds and writes the new role when at least one other admin exists', async () => {
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 1 }])

    await expect(
      setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')
    ).resolves.toBeDefined()

    expect(hoisted.mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'member' }))
  })

  it('acquires the advisory lock before counting (serializes concurrent demotions)', async () => {
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 1 }])

    await setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')

    expect(hoisted.mockExecute).toHaveBeenCalled()
    const lockCallOrder = hoisted.mockExecute.mock.invocationCallOrder[0]
    const countCallOrder = hoisted.mockSelectWhere.mock.invocationCallOrder[0]
    expect(lockCallOrder).toBeLessThan(countCallOrder)
  })

  it('excludes the target by principalId when addressed via { principalId }', async () => {
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 1 }])

    await setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')

    const predicate = hoisted.mockSelectWhere.mock.calls[0][0]
    const serialized = JSON.stringify(predicate)
    // The exclusion clause must reference this target's principalId (not
    // some other identity) — the whole point of "excluding self".
    expect(serialized).toContain(TARGET_PRINCIPAL_ID)
    expect(serialized).not.toContain(TARGET_USER_ID)
  })

  it('excludes the target by userId when addressed via { userId }', async () => {
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 1 }])
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'user',
      role: 'admin',
      userId: TARGET_USER_ID,
    })

    await setPrincipalRole({ userId: TARGET_USER_ID }, 'member')

    const predicate = hoisted.mockSelectWhere.mock.calls[0][0]
    const serialized = JSON.stringify(predicate)
    expect(serialized).toContain(TARGET_USER_ID)
    expect(serialized).not.toContain(TARGET_PRINCIPAL_ID)
  })

  it('skips the lock/count entirely when the target is not currently an admin', async () => {
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'user',
      role: 'member',
      userId: OWNING_USER_ID,
    })

    await setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')

    // Nothing to protect — a non-admin being "demoted" never needs the
    // last-admin count. The role write still proceeds normally.
    expect(hoisted.mockSelectWhere).not.toHaveBeenCalled()
    expect(hoisted.mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'member' }))
  })

  it('skips the lock/count entirely when promoting to admin', async () => {
    await setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'admin')

    // role === 'admin' short-circuits both the transaction wrap and the
    // guard block (`role !== 'admin'` gates both) — promotions never
    // shrink the admin set, so there's nothing to protect.
    expect(hoisted.mockSelectWhere).not.toHaveBeenCalled()
    expect(hoisted.mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }))
  })

  it('service-type and anonymous principals are never subject to the admin guard', async () => {
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'service',
      role: 'admin',
      userId: null,
    })

    await setPrincipalRole({ principalId: TARGET_PRINCIPAL_ID }, 'member')

    expect(hoisted.mockSelectWhere).not.toHaveBeenCalled()
    expect(hoisted.mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: 'member' }))
  })
})
