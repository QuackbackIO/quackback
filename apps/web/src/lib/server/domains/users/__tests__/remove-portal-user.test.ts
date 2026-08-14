import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  deleteWhere: vi.fn(),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}))

vi.mock('@/lib/server/db', () => {
  const tx = {
    update: () => ({
      set: (values: unknown) => {
        hoisted.updateSet(values)
        return { where: (...args: unknown[]) => hoisted.updateWhere(...args) }
      },
    }),
    delete: () => ({
      where: (...args: unknown[]) => hoisted.deleteWhere(...args),
    }),
  }
  return {
    db: {
      query: { principal: { findFirst: (...args: unknown[]) => hoisted.findFirst(...args) } },
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
    principal: { id: 'principal.id', role: 'principal.role' },
    session: { userId: 'session.userId' },
    user: {},
    posts: {},
    comments: {},
    votes: {},
    userSegments: {},
    segments: {},
    eq: (...args: unknown[]) => hoisted.eq(...args),
    and: (...args: unknown[]) => hoisted.and(...args),
    or: vi.fn(),
    ilike: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    desc: vi.fn(),
    asc: vi.fn(),
    sql: vi.fn(),
  }
})

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: vi.fn(), debug: vi.fn(), info: vi.fn() }) },
}))

const { removePortalUser } = await import('../user.service')

const PRINCIPAL_ID = 'principal_portal1' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.updateWhere.mockResolvedValue(undefined)
  hoisted.deleteWhere.mockResolvedValue(undefined)
})

describe('removePortalUser', () => {
  it('throws when the principal is missing or not a portal user', async () => {
    hoisted.findFirst.mockResolvedValue(null)

    await expect(removePortalUser(PRINCIPAL_ID)).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
    })
    expect(hoisted.updateSet).not.toHaveBeenCalled()
    expect(hoisted.deleteWhere).not.toHaveBeenCalled()
  })

  it('anonymizes the principal and revokes sessions for the detached user', async () => {
    hoisted.findFirst.mockResolvedValue({
      id: PRINCIPAL_ID,
      userId: 'user_1',
      role: 'user',
    })

    await removePortalUser(PRINCIPAL_ID)

    expect(hoisted.updateSet).toHaveBeenCalledWith({
      userId: null,
      type: 'anonymous',
      displayName: 'Removed user',
      avatarUrl: null,
      avatarKey: null,
      contactEmail: null,
    })
    expect(hoisted.updateWhere).toHaveBeenCalledWith({ col: 'principal.id', val: PRINCIPAL_ID })
    expect(hoisted.deleteWhere).toHaveBeenCalledWith({ col: 'session.userId', val: 'user_1' })
  })

  it('skips session delete when the principal has no userId', async () => {
    hoisted.findFirst.mockResolvedValue({
      id: PRINCIPAL_ID,
      userId: null,
      role: 'user',
    })

    await removePortalUser(PRINCIPAL_ID)

    expect(hoisted.updateSet).toHaveBeenCalled()
    expect(hoisted.deleteWhere).not.toHaveBeenCalled()
  })
})
