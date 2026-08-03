/**
 * Phase 6: webhook dispatch from team CRUD.
 *
 * Verifies that `createTeam`, `updateTeam`, `archiveTeam`, and `unarchiveTeam`
 * fire the matching configuration-plane dispatchers, that `team.updated`
 * carries the changed field list (with `unarchiveTeam` reporting
 * `['archivedAt']`), and that no `team.unarchived` event exists (per design).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const teamFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()

const dispatchTeamCreatedMock = vi.fn()
const dispatchTeamUpdatedMock = vi.fn()
const dispatchTeamArchivedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; userId?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  userId: input.userId,
  displayName: 'team-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      teams: { findFirst: teamFindFirstMock, findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: updateReturningMock,
    })),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  inArray: vi.fn(),
  asc: vi.fn(),
  teams: { _name: 'teams', id: 'id', slug: 'slug' },
  teamMemberships: { _name: 'team_memberships' },
}))

vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTeamCreated: (...a: unknown[]) => dispatchTeamCreatedMock(...a),
  dispatchTeamUpdated: (...a: unknown[]) => dispatchTeamUpdatedMock(...a),
  dispatchTeamArchived: (...a: unknown[]) => dispatchTeamArchivedMock(...a),
  buildEventActor: (...a: unknown[]) =>
    buildEventActorMock(...(a as [{ principalId: string; userId?: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const ACTOR = { principalId: 'principal_a' as never, userId: 'user_a' as never }

const SAMPLE_TEAM = {
  id: 'team_1',
  slug: 'support',
  name: 'Support',
  description: null,
  shortLabel: null,
  color: null,
  archivedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

describe('team.service events (Phase 6)', () => {
  it('dispatches team.created on create', async () => {
    teamFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_TEAM])

    const { createTeam } = await import('../team.service')
    await createTeam({ slug: 'support', name: 'Support' }, ACTOR)

    expect(dispatchTeamCreatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchTeamCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', principalId: 'principal_a' }),
      SAMPLE_TEAM
    )
  })

  it('dispatches team.updated with computed changedFields', async () => {
    teamFindFirstMock.mockResolvedValue(SAMPLE_TEAM)
    const updated = { ...SAMPLE_TEAM, name: 'Renamed', color: '#ff0000' }
    updateReturningMock.mockResolvedValue([updated])

    const { updateTeam } = await import('../team.service')
    await updateTeam(
      'team_1' as never,
      { name: 'Renamed', color: '#ff0000', shortLabel: null },
      ACTOR
    )

    expect(dispatchTeamUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changed] = dispatchTeamUpdatedMock.mock.calls[0] as [unknown, unknown, string[]]
    expect(changed.sort()).toEqual(['color', 'name'])
  })

  it('dispatches team.updated with empty changedFields when nothing changes', async () => {
    teamFindFirstMock.mockResolvedValue(SAMPLE_TEAM)
    updateReturningMock.mockResolvedValue([SAMPLE_TEAM])

    const { updateTeam } = await import('../team.service')
    await updateTeam('team_1' as never, { name: SAMPLE_TEAM.name }, ACTOR)

    expect(dispatchTeamUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changed] = dispatchTeamUpdatedMock.mock.calls[0] as [unknown, unknown, string[]]
    expect(changed).toEqual([])
  })

  it('dispatches team.archived on archive', async () => {
    const archived = { ...SAMPLE_TEAM, archivedAt: new Date('2025-02-01') }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveTeam } = await import('../team.service')
    await archiveTeam('team_1' as never, ACTOR)

    expect(dispatchTeamArchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchTeamArchivedMock).toHaveBeenCalledWith(expect.any(Object), archived)
  })

  it('unarchiveTeam dispatches team.updated with archivedAt only', async () => {
    const restored = { ...SAMPLE_TEAM, archivedAt: null }
    updateReturningMock.mockResolvedValue([restored])

    const { unarchiveTeam } = await import('../team.service')
    await unarchiveTeam('team_1' as never, ACTOR)

    expect(dispatchTeamUpdatedMock).toHaveBeenCalledWith(expect.any(Object), restored, [
      'archivedAt',
    ])
    expect(dispatchTeamArchivedMock).not.toHaveBeenCalled()
  })

  it('uses service actor when principalId is null', async () => {
    teamFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_TEAM])

    const { createTeam } = await import('../team.service')
    await createTeam({ slug: 'support', name: 'Support' }, { principalId: null })

    expect(dispatchTeamCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'team-system' }),
      SAMPLE_TEAM
    )
  })

  it('swallows dispatcher errors', async () => {
    teamFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_TEAM])
    dispatchTeamCreatedMock.mockRejectedValueOnce(new Error('hook boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createTeam } = await import('../team.service')
    const result = await createTeam({ slug: 'support', name: 'Support' }, ACTOR)

    expect(result).toEqual(SAMPLE_TEAM)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
