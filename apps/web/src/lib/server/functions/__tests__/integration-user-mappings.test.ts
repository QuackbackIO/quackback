/**
 * The account-matching server functions: listing needs `integration.view`,
 * matching, removing, suggesting and looking up a login need
 * `integration.manage`, a refused caller reaches no service, and every match
 * or removal is audited with the account and the teammate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findIntegration: vi.fn(),
  list: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  audit: vi.fn(),
  listDestinations: vi.fn(),
  teammates: vi.fn(),
  suggest: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: { query: { integrations: { findFirst: mocks.findIntegration } } },
}))
vi.mock('@/lib/server/integrations/user-mappings', () => ({
  listUserMappings: mocks.list,
  upsertUserMapping: mocks.upsert,
  deleteUserMapping: mocks.remove,
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: mocks.audit,
  actorFromAuth: () => ({ userId: 'user_admin' }),
}))
vi.mock('@/lib/server/integrations/destinations', () => ({
  listDestinations: mocks.listDestinations,
}))
vi.mock('@/lib/server/domains/teams/team.service', () => ({
  listAssignableTeammates: mocks.teammates,
}))
vi.mock('@/lib/server/integrations/token-refresh', () => ({
  withIntegrationReadAuth: (_id: string, read: (auth: { accessToken: string }) => unknown) =>
    read({ accessToken: 'tok' }),
}))
vi.mock('@/integrations/github/server/people', () => ({
  suggestGitHubPeople: mocks.suggest,
  getGitHubUser: mocks.getUser,
}))

import {
  deleteIntegrationUserMappingFn,
  listIntegrationUserMappingsFn,
  upsertIntegrationUserMappingFn,
} from '../integration-user-mappings'
import { findGitHubUserFn, suggestGitHubPeopleFn } from '@/integrations/github/server/functions'

const github = { id: 'integration_gh', status: 'active', secrets: 'enc', config: {} }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  mocks.findIntegration.mockResolvedValue(github)
})

const permissionsAsked = () => mocks.requireAuth.mock.calls.map(([opts]) => opts?.permission)

describe('integration user mapping server functions', () => {
  it('lists with integration.view, and nothing for an unconnected integration', async () => {
    mocks.list.mockResolvedValue([{ id: 'm1' }])
    expect(await listIntegrationUserMappingsFn({ data: { integrationType: 'github' } })).toEqual([
      { id: 'm1' },
    ])
    mocks.findIntegration.mockResolvedValue(undefined)
    expect(await listIntegrationUserMappingsFn({ data: { integrationType: 'github' } })).toEqual([])
    expect(permissionsAsked()).toEqual([PERMISSIONS.INTEGRATION_VIEW, PERMISSIONS.INTEGRATION_VIEW])
  })

  it('matches with integration.manage, as the caller, and audits the change', async () => {
    mocks.upsert.mockResolvedValue({
      mapping: {
        id: 'm1',
        externalUserId: '42',
        externalLogin: 'jane',
        principalId: 'principal_jane',
      },
      previous: { externalLogin: 'jane', principalId: 'principal_old' },
    })
    await upsertIntegrationUserMappingFn({
      data: {
        integrationType: 'github',
        externalUserId: '42',
        externalLogin: 'jane',
        principalId: 'principal_jane',
      },
    })
    expect(permissionsAsked()).toEqual([PERMISSIONS.INTEGRATION_MANAGE])
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'integration_gh',
        externalUserId: '42',
        principalId: 'principal_jane',
        createdByPrincipalId: 'principal_admin',
      })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'integration.user_mapping.added',
        target: { type: 'integration_user_mapping', id: 'm1' },
        before: { externalLogin: 'jane', principalId: 'principal_old' },
        after: expect.objectContaining({ externalUserId: '42', principalId: 'principal_jane' }),
      })
    )
  })

  it('removes with integration.manage and audits the removal', async () => {
    mocks.remove.mockResolvedValue({
      id: 'm1',
      externalUserId: '42',
      externalLogin: 'jane',
      principalId: 'principal_jane',
    })
    await deleteIntegrationUserMappingFn({ data: { integrationType: 'github', mappingId: 'm1' } })
    expect(permissionsAsked()).toEqual([PERMISSIONS.INTEGRATION_MANAGE])
    expect(mocks.remove).toHaveBeenCalledWith('integration_gh', 'm1')
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'integration.user_mapping.removed',
        before: expect.objectContaining({ externalLogin: 'jane', principalId: 'principal_jane' }),
      })
    )
  })

  it('reaches no service and audits nothing when the caller is refused', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Forbidden'))
    await expect(
      upsertIntegrationUserMappingFn({
        data: {
          integrationType: 'github',
          externalUserId: '1',
          externalLogin: 'a',
          principalId: 'p',
        },
      })
    ).rejects.toThrow('Forbidden')
    await expect(
      deleteIntegrationUserMappingFn({ data: { integrationType: 'github', mappingId: 'm1' } })
    ).rejects.toThrow('Forbidden')
    await expect(suggestGitHubPeopleFn()).rejects.toThrow('Forbidden')
    await expect(findGitHubUserFn({ data: { login: 'jane' } })).rejects.toThrow('Forbidden')
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.suggest).not.toHaveBeenCalled()
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('suggests across switched-on repositories with integration.manage, storing nothing', async () => {
    mocks.listDestinations.mockResolvedValue([
      { externalId: 'acme/app', enabled: true },
      { externalId: 'acme/old', enabled: false },
    ])
    mocks.list.mockResolvedValue([{ externalUserId: '9', principalId: 'principal_ravi' }])
    mocks.teammates.mockResolvedValue([
      { principalId: 'principal_jane', name: 'Jane', email: null },
    ])
    mocks.suggest.mockResolvedValue({ scanned: 3, suggestions: [] })
    expect(await suggestGitHubPeopleFn()).toEqual({ scanned: 3, suggestions: [] })
    expect(permissionsAsked()).toEqual([PERMISSIONS.INTEGRATION_MANAGE])
    expect(mocks.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'tok',
        repositories: ['acme/app'],
        mappedAccountIds: new Set(['9']),
        mappedPrincipalIds: new Set(['principal_ravi']),
      })
    )
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('looks a login up with integration.manage and refuses one GitHub does not know', async () => {
    mocks.getUser.mockResolvedValueOnce({
      id: '7',
      login: 'Octo',
      name: 'Octo Cat',
      avatarUrl: null,
      email: 'o@x.test',
    })
    expect(await findGitHubUserFn({ data: { login: '@octo' } })).toEqual({
      id: '7',
      login: 'Octo',
      name: 'Octo Cat',
      avatarUrl: null,
    })
    expect(mocks.getUser).toHaveBeenCalledWith('tok', 'octo')
    mocks.getUser.mockResolvedValueOnce(null)
    await expect(findGitHubUserFn({ data: { login: 'ghost' } })).rejects.toThrow('@ghost')
    expect(permissionsAsked()).toEqual([
      PERMISSIONS.INTEGRATION_MANAGE,
      PERMISSIONS.INTEGRATION_MANAGE,
    ])
  })
})
