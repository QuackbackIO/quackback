import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockCreateTeam: vi.fn(),
  mockUpdateTeam: vi.fn(),
  mockArchiveTeam: vi.fn(),
  mockUnarchiveTeam: vi.fn(),
  mockGetTeam: vi.fn(),
  mockListTeams: vi.fn(),
  mockAddMember: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockListMembers: vi.fn(),
  mockRecordEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/teams', () => ({
  createTeam: (...args: unknown[]) => hoisted.mockCreateTeam(...args),
  updateTeam: (...args: unknown[]) => hoisted.mockUpdateTeam(...args),
  archiveTeam: (...args: unknown[]) => hoisted.mockArchiveTeam(...args),
  unarchiveTeam: (...args: unknown[]) => hoisted.mockUnarchiveTeam(...args),
  getTeam: (...args: unknown[]) => hoisted.mockGetTeam(...args),
  listTeams: (...args: unknown[]) => hoisted.mockListTeams(...args),
  addMember: (...args: unknown[]) => hoisted.mockAddMember(...args),
  removeMember: (...args: unknown[]) => hoisted.mockRemoveMember(...args),
  listMembers: (...args: unknown[]) => hoisted.mockListMembers(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

await import('../teams')

const [
  listTeamsFn,
  getTeamFn,
  createTeamFn,
  updateTeamFn,
  archiveTeamFn,
  unarchiveTeamFn,
  listTeamMembersFn,
  addTeamMemberFn,
  removeTeamMemberFn,
] = handlersByIndex

if (!removeTeamMemberFn) {
  throw new Error(`team handlers were not registered; found ${handlersByIndex.length}`)
}

const ctx = {
  principal: { id: 'principal_admin' },
  user: { id: 'user_admin' },
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team_support',
    slug: 'support',
    name: 'Support',
    description: 'Customer support',
    shortLabel: 'SUP',
    color: '#123456',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue(ctx)
  hoisted.mockListTeams.mockResolvedValue([team()])
  hoisted.mockGetTeam.mockResolvedValue(team({ name: 'Before' }))
  hoisted.mockCreateTeam.mockResolvedValue(team({ name: 'Created' }))
  hoisted.mockUpdateTeam.mockResolvedValue(team({ name: 'Updated' }))
  hoisted.mockArchiveTeam.mockResolvedValue(undefined)
  hoisted.mockUnarchiveTeam.mockResolvedValue(undefined)
  hoisted.mockListMembers.mockResolvedValue([{ principalId: 'principal_agent' }])
  hoisted.mockAddMember.mockResolvedValue({
    teamId: 'team_support',
    principalId: 'principal_agent',
  })
  hoisted.mockRemoveMember.mockResolvedValue(undefined)
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('team server functions', () => {
  it('runs team read functions behind admin.manage_users', async () => {
    await expect(listTeamsFn({ data: { includeArchived: true } })).resolves.toEqual([team()])
    expect(hoisted.mockListTeams).toHaveBeenCalledWith({ includeArchived: true })

    await expect(getTeamFn({ data: { teamId: 'team_support' } })).resolves.toEqual(
      team({ name: 'Before' })
    )
    expect(hoisted.mockGetTeam).toHaveBeenCalledWith('team_support')

    await expect(listTeamMembersFn({ data: { teamId: 'team_support' } })).resolves.toEqual([
      { principalId: 'principal_agent' },
    ])
    expect(hoisted.mockListMembers).toHaveBeenCalledWith('team_support')
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ADMIN_MANAGE_USERS)
  })

  it('creates, updates, archives, and unarchives teams with audit events', async () => {
    await expect(
      createTeamFn({
        data: {
          slug: 'support',
          name: 'Created',
          description: 'Customer support',
          shortLabel: 'SUP',
          color: '#123456',
        },
      })
    ).resolves.toEqual(team({ name: 'Created' }))
    expect(hoisted.mockCreateTeam).toHaveBeenCalledWith(
      {
        slug: 'support',
        name: 'Created',
        description: 'Customer support',
        shortLabel: 'SUP',
        color: '#123456',
      },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(
      updateTeamFn({ data: { teamId: 'team_support', name: 'Updated', color: '#654321' } })
    ).resolves.toEqual(team({ name: 'Updated' }))
    expect(hoisted.mockUpdateTeam).toHaveBeenCalledWith(
      'team_support',
      { teamId: 'team_support', name: 'Updated', color: '#654321' },
      { principalId: 'principal_admin', userId: 'user_admin' }
    )

    await expect(archiveTeamFn({ data: { teamId: 'team_support' } })).resolves.toEqual({
      ok: true,
    })
    await expect(unarchiveTeamFn({ data: { teamId: 'team_support' } })).resolves.toEqual({
      ok: true,
    })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.created', targetId: 'team_support' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.updated', targetId: 'team_support' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.archived', targetId: 'team_support' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.unarchived', targetId: 'team_support' })
    )
  })

  it('records team updates with no before diff when the team did not exist', async () => {
    hoisted.mockGetTeam.mockResolvedValueOnce(null)

    await updateTeamFn({ data: { teamId: 'team_support', name: 'Updated' } })

    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.updated',
        diff: expect.objectContaining({ before: undefined }),
      })
    )
  })

  it('adds and removes team members with audit context', async () => {
    await expect(
      addTeamMemberFn({
        data: { teamId: 'team_support', principalId: 'principal_agent', role: 'lead' },
      })
    ).resolves.toEqual({ teamId: 'team_support', principalId: 'principal_agent' })
    expect(hoisted.mockAddMember).toHaveBeenCalledWith('team_support', 'principal_agent', 'lead')

    await expect(
      removeTeamMemberFn({ data: { teamId: 'team_support', principalId: 'principal_agent' } })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockRemoveMember).toHaveBeenCalledWith('team_support', 'principal_agent')
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.member_added',
        diff: { after: { principalId: 'principal_agent', role: 'lead' } },
      })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.member_removed',
        diff: { before: { principalId: 'principal_agent' } },
      })
    )
  })

  it('does not call team domains when permission is denied', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('admin.manage_users required'))

    await expect(listTeamsFn({ data: {} })).rejects.toThrow('admin.manage_users required')

    expect(hoisted.mockListTeams).not.toHaveBeenCalled()
    expect(hoisted.mockCreateTeam).not.toHaveBeenCalled()
  })
})
