import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = () => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler(fn: AnyHandler) {
      handlersByIndex.push(fn)
      return fn
    },
  }),
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockLoadPermissionSet: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.mockLoadPermissionSet(...args),
}))

await import('../authz')

const [getMyPermissionsFn] = handlersByIndex

if (!getMyPermissionsFn) {
  throw new Error(`authz handlers were not registered; found ${handlersByIndex.length}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    principal: { id: 'principal_admin' },
  })
  hoisted.mockLoadPermissionSet.mockResolvedValue({
    principalId: 'principal_admin',
    workspacePermissions: new Set([PERMISSIONS.ADMIN_MANAGE_ROLES]),
    teamPermissions: new Map([
      ['team_support', new Set([PERMISSIONS.TICKET_VIEW_TEAM, PERMISSIONS.TICKET_REPLY_PUBLIC])],
    ]),
    teamIds: new Set(['team_support']),
  })
})

describe('getMyPermissionsFn', () => {
  it('serializes the current principal permission set for client permission gates', async () => {
    const result = await getMyPermissionsFn()

    expect(result).toEqual({
      principalId: 'principal_admin',
      workspacePermissions: [PERMISSIONS.ADMIN_MANAGE_ROLES],
      teamPermissions: [
        {
          teamId: 'team_support',
          permissions: [PERMISSIONS.TICKET_VIEW_TEAM, PERMISSIONS.TICKET_REPLY_PUBLIC],
        },
      ],
      teamIds: ['team_support'],
    })
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin', 'member', 'user'] })
    expect(hoisted.mockLoadPermissionSet).toHaveBeenCalledWith('principal_admin')
  })

  it('does not load permissions when authentication fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('login required'))

    await expect(getMyPermissionsFn()).rejects.toThrow('login required')

    expect(hoisted.mockLoadPermissionSet).not.toHaveBeenCalled()
  })
})
