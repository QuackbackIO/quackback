/**
 * Differential-coverage tests for team.service — create/update/archive with
 * validation + dup + changed-field diffing, event dispatch (actor + kind +
 * failure), membership upsert (idempotent / role change / insert), and the
 * list helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  teamsFindFirst: vi.fn(),
  teamsFindMany: vi.fn(),
  membersFindFirst: vi.fn(),
  membersFindMany: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  deleteWhere: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({ type: 'principal', displayName: 'team-system' })),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dArchived: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      teams: { findFirst: m.teamsFindFirst, findMany: m.teamsFindMany },
      teamMemberships: { findFirst: m.membersFindFirst, findMany: m.membersFindMany },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    delete: () => ({ where: (...a: unknown[]) => m.deleteWhere(...a) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  teams: { id: 't.id', slug: 't.slug', name: 't.name', archivedAt: 't.archivedAt' },
  teamMemberships: { id: 'tm.id', teamId: 'tm.teamId', principalId: 'tm.principalId' },
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTeamCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchTeamUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchTeamArchived: (...a: unknown[]) => m.dArchived(...a),
}))

import * as svc from '../team.service'

const withP = { principalId: 'p1' as never, userId: 'u1' as never }
const svcActor = { principalId: null }

beforeEach(() => {
  vi.clearAllMocks()
  m.teamsFindFirst.mockResolvedValue(undefined)
  m.teamsFindMany.mockResolvedValue([{ id: 'team_1' }])
  m.membersFindFirst.mockResolvedValue(undefined)
  m.membersFindMany.mockResolvedValue([{ teamId: 'team_1' }])
  m.insertReturning.mockResolvedValue([{ id: 'team_1', name: 'Eng' }])
  m.updateReturning.mockResolvedValue([{ id: 'team_1', name: 'Eng' }])
  m.deleteWhere.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createTeam', () => {
  it('requires a name', async () => {
    await expect(svc.createTeam({ slug: 'eng', name: ' ' }, svcActor)).rejects.toThrow(
      'name is required'
    )
  })
  it('rejects an invalid slug', async () => {
    await expect(svc.createTeam({ slug: 'Bad Slug', name: 'X' }, svcActor)).rejects.toThrow(
      'slug must be'
    )
  })
  it('rejects a duplicate slug', async () => {
    m.teamsFindFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(svc.createTeam({ slug: 'eng', name: 'X' }, svcActor)).rejects.toThrow(
      'already exists'
    )
  })
  it('creates and fires created with a principal actor', async () => {
    const t = await svc.createTeam({ slug: 'eng', name: ' Eng ', description: 'd' }, withP)
    expect(t).toEqual({ id: 'team_1', name: 'Eng' })
    expect(m.buildEventActor).toHaveBeenCalled()
    expect(m.dCreated).toHaveBeenCalled()
  })
})

describe('updateTeam', () => {
  it('throws when missing', async () => {
    m.teamsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.updateTeam('t1' as never, { name: 'x' }, svcActor)).rejects.toThrow(
      'not found'
    )
  })
  it('diffs all changed fields and fires updated (service actor)', async () => {
    m.teamsFindFirst.mockResolvedValueOnce({
      id: 't1',
      name: 'Old',
      description: null,
      shortLabel: null,
      color: null,
    })
    m.updateReturning.mockResolvedValueOnce([{ id: 't1', name: 'New' }])
    await svc.updateTeam(
      't1' as never,
      { name: 'New', description: 'd', shortLabel: 's', color: '#fff' },
      svcActor
    )
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('fires with no changes when input matches existing', async () => {
    m.teamsFindFirst.mockResolvedValueOnce({
      id: 't1',
      name: 'Same',
      description: 'd',
      shortLabel: 's',
      color: 'c',
    })
    m.updateReturning.mockResolvedValueOnce([{ id: 't1', name: 'Same' }])
    await svc.updateTeam('t1' as never, {}, svcActor)
    expect(m.dUpdated).toHaveBeenCalled()
  })
})

describe('archive / unarchive', () => {
  it('archive fires when a row returns, not when empty', async () => {
    await svc.archiveTeam('t1' as never, withP)
    expect(m.dArchived).toHaveBeenCalled()
    m.updateReturning.mockResolvedValueOnce([])
    await svc.archiveTeam('t1' as never, withP)
    expect(m.dArchived).toHaveBeenCalledTimes(1)
  })
  it('unarchive fires updated with archivedAt, not when empty', async () => {
    await svc.unarchiveTeam('t1' as never, withP)
    expect(m.dUpdated).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['archivedAt'])
    m.updateReturning.mockResolvedValueOnce([])
    await svc.unarchiveTeam('t1' as never, withP)
    expect(m.dUpdated).toHaveBeenCalledTimes(1)
  })
})

describe('getters', () => {
  it('getTeam returns null when missing', async () => {
    expect(await svc.getTeam('t1' as never)).toBeNull()
  })
  it('listTeams with and without archived', async () => {
    expect(await svc.listTeams()).toEqual([{ id: 'team_1' }])
    expect(await svc.listTeams({ includeArchived: true })).toEqual([{ id: 'team_1' }])
  })
})

describe('memberships', () => {
  it('addMember: idempotent when role matches', async () => {
    m.membersFindFirst.mockResolvedValueOnce({ id: 'mem_1', role: 'member' })
    expect(await svc.addMember('t1' as never, 'p1' as never, 'member')).toEqual({
      id: 'mem_1',
      role: 'member',
    })
    expect(m.insertReturning).not.toHaveBeenCalled()
  })
  it('addMember: updates the role when it differs', async () => {
    m.membersFindFirst.mockResolvedValueOnce({ id: 'mem_1', role: 'member' })
    m.updateReturning.mockResolvedValueOnce([{ id: 'mem_1', role: 'lead' }])
    expect(await svc.addMember('t1' as never, 'p1' as never, 'lead')).toEqual({
      id: 'mem_1',
      role: 'lead',
    })
  })
  it('addMember: inserts a new membership', async () => {
    m.insertReturning.mockResolvedValueOnce([{ id: 'mem_new', role: 'member' }])
    expect(await svc.addMember('t1' as never, 'p1' as never)).toEqual({
      id: 'mem_new',
      role: 'member',
    })
  })
  it('removeMember, listMembers, listTeamsForPrincipal', async () => {
    await svc.removeMember('t1' as never, 'p1' as never)
    expect(m.deleteWhere).toHaveBeenCalled()
    m.membersFindMany.mockResolvedValueOnce([{ id: 'mem_1' }])
    expect(await svc.listMembers('t1' as never)).toEqual([{ id: 'mem_1' }])
    m.membersFindMany.mockResolvedValueOnce([{ teamId: 'team_1' }, { teamId: 'team_2' }])
    expect(await svc.listTeamsForPrincipal('p1' as never)).toEqual(['team_1', 'team_2'])
  })
})

describe('fireTeamEvent failure', () => {
  it('swallows dispatch errors', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    await svc.createTeam({ slug: 'eng', name: 'Eng' }, svcActor)
    expect(console.warn).toHaveBeenCalled()
  })
})
