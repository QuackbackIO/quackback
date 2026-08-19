import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

const operations: string[] = []
const mockDeleteWhere = vi.fn()

const mockExec = {
  delete: (table: { __name?: string }) => {
    operations.push(`delete:${table.__name || 'unknown'}`)
    return { where: mockDeleteWhere }
  },
}

vi.mock('@/lib/server/db', () => ({
  db: {},
  principal: { id: 'principal.id', userId: 'principal.userId', __name: 'principal' },
  session: { userId: 'session.userId', __name: 'session' },
  user: { id: 'user.id', __name: 'user' },
  eq: vi.fn((col: unknown, val: unknown) => ({ _type: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ _type: 'and', args })),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { deleteAnonymousIdentity } from '../principal.factory'

const PRINCIPAL_ID = 'principal_anon' as PrincipalId
const USER_ID = 'user_anon' as UserId

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = mockExec as any

describe('deleteAnonymousIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operations.length = 0
    mockDeleteWhere.mockResolvedValue(undefined)
  })

  it('deletes principal, sessions, and user on the given executor', async () => {
    await deleteAnonymousIdentity({ principalId: PRINCIPAL_ID, userId: USER_ID }, exec)

    expect(operations).toContain('delete:principal')
    expect(operations).toContain('delete:session')
    expect(operations).toContain('delete:user')
  })

  it('deletes the principal before sessions and user (it references user_id)', async () => {
    await deleteAnonymousIdentity({ principalId: PRINCIPAL_ID, userId: USER_ID }, exec)

    const principalIdx = operations.indexOf('delete:principal')
    expect(principalIdx).toBeLessThan(operations.indexOf('delete:session'))
    expect(principalIdx).toBeLessThan(operations.indexOf('delete:user'))
  })

  it('skips the principal delete when the identity never had one', async () => {
    await deleteAnonymousIdentity({ principalId: null, userId: USER_ID }, exec)

    expect(operations).not.toContain('delete:principal')
    expect(operations).toContain('delete:session')
    expect(operations).toContain('delete:user')
  })

  it('scopes deletes to the given ids', async () => {
    const { eq } = await import('@/lib/server/db')
    await deleteAnonymousIdentity({ principalId: PRINCIPAL_ID, userId: USER_ID }, exec)

    expect(eq).toHaveBeenCalledWith('principal.id', PRINCIPAL_ID)
    expect(eq).toHaveBeenCalledWith('session.userId', USER_ID)
    expect(eq).toHaveBeenCalledWith('user.id', USER_ID)
  })
})
