/**
 * Roster writes go through the principal factory. Those paths must enqueue
 * membership-sync so a teammate change is not waiting on a control-plane poll.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  enqueueMembershipSync: vi.fn(async () => {}),
  mockExecute: vi.fn(),
  mockFindFirst: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockInsertValues: vi.fn(),
  mockCacheDel: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: (...args: unknown[]) => hoisted.enqueueMembershipSync(...args),
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: hoisted.mockCacheDel,
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function buildExecutor() {
    return {
      execute: hoisted.mockExecute,
      query: { principal: { findFirst: hoisted.mockFindFirst } },
      select: () => ({ from: () => ({ where: hoisted.mockSelectWhere }) }),
      insert: () => ({
        values: (arg: unknown) => {
          hoisted.mockInsertValues(arg)
          return {
            returning: async () => [
              {
                id: 'principal_new',
                type: 'user',
                role: 'member',
                userId: 'user_new',
              },
            ],
            onConflictDoNothing: () => ({
              returning: async () => [
                {
                  id: 'principal_new',
                  type: 'user',
                  role: 'member',
                  userId: 'user_new',
                },
              ],
            }),
          }
        },
      }),
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
    principal: { id: 'pid', role: 'role', type: 'type', userId: 'userId' },
    eq: drizzle.eq,
    ne: drizzle.ne,
    and: drizzle.and,
    sql: drizzle.sql,
  }
})

import { createPrincipal, setPrincipalRole } from '../principal.factory'

const TARGET = 'principal_target' as PrincipalId

describe('membership-sync enqueue from roster writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockExecute.mockResolvedValue(undefined)
    hoisted.mockUpdateWhere.mockResolvedValue(undefined)
    hoisted.mockSelectWhere.mockResolvedValue([{ count: 1 }])
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'user',
      role: 'admin',
      userId: 'user_owner' as UserId,
    })
  })

  it('enqueues when a teammate role is written', async () => {
    await setPrincipalRole({ principalId: TARGET }, 'member')
    expect(hoisted.enqueueMembershipSync).toHaveBeenCalled()
  })

  it('does not enqueue when a service principal is demoted', async () => {
    hoisted.mockFindFirst.mockResolvedValue({
      type: 'service',
      role: 'admin',
      userId: null,
    })
    await setPrincipalRole({ principalId: TARGET }, 'member')
    expect(hoisted.enqueueMembershipSync).not.toHaveBeenCalled()
  })

  it('enqueues when a teammate principal is created', async () => {
    await createPrincipal({ role: 'member', userId: 'user_new' as UserId })
    expect(hoisted.enqueueMembershipSync).toHaveBeenCalled()
  })
})
