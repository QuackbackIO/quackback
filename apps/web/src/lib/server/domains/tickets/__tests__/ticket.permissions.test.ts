/**
 * ticket.permissions — unit tests for the per-ticket permission helpers.
 *
 * Uses synthetic `PermissionSet` and `ResourceScope` objects so we can verify
 * the exact combinations of workspace/team grants and resource shapes without
 * touching the database.
 */
import { describe, it, expect } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '../../authz'
import type { PermissionSet } from '../../authz/authz.service'
import type { PrincipalId, TeamId } from '@quackback/ids'
import {
  canAssign,
  canAssignSelf,
  canEditFields,
  canManageParticipants,
  canReplyPublic,
  canShareCrossTeam,
  canViewTicket,
  toResourceScope,
} from '../ticket.permissions'

const P = (s: string) => s as unknown as PrincipalId
const T = (s: string) => s as unknown as TeamId

function makeSet(opts: {
  principalId?: PrincipalId
  workspace?: PermissionKey[]
  team?: Record<string, PermissionKey[]>
  teamIds?: TeamId[]
}): PermissionSet {
  const teamPermissions = new Map<TeamId, ReadonlySet<PermissionKey>>()
  for (const [k, v] of Object.entries(opts.team ?? {})) {
    teamPermissions.set(T(k), new Set(v))
  }
  return {
    principalId: opts.principalId ?? P('user_a'),
    workspacePermissions: new Set(opts.workspace ?? []),
    teamPermissions,
    teamIds: opts.teamIds ?? Object.keys(opts.team ?? {}).map(T),
  }
}

describe('toResourceScope', () => {
  it('drops revoked shares', () => {
    const scope = toResourceScope({
      primaryTeamId: T('team_x'),
      assigneePrincipalId: P('user_b'),
      assigneeTeamId: null,
      shares: [
        { teamId: T('team_y'), revokedAt: null },
        { teamId: T('team_z'), revokedAt: new Date() },
      ],
    })
    expect(scope.sharedTeamIds).toEqual([T('team_y')])
    expect(scope.primaryTeamId).toBe(T('team_x'))
  })
})

describe('canViewTicket', () => {
  const baseScope = {
    primaryTeamId: T('team_x'),
    assigneePrincipalId: null,
    assigneeTeamId: null,
    sharedTeamIds: [] as TeamId[],
  }

  it('grants when actor has TICKET_VIEW_ALL workspace-wide', () => {
    const set = makeSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] })
    expect(canViewTicket(set, baseScope)).toBe(true)
  })

  it('grants when actor is in the owning team and holds team_view', () => {
    const set = makeSet({
      team: { team_x: [PERMISSIONS.TICKET_VIEW_TEAM] },
    })
    expect(canViewTicket(set, baseScope)).toBe(true)
  })

  it('denies when actor has team_view but for a different team', () => {
    const set = makeSet({
      team: { team_other: [PERMISSIONS.TICKET_VIEW_TEAM] },
    })
    expect(canViewTicket(set, baseScope)).toBe(false)
  })

  it("grants via shared scope when ticket is shared with one of actor's teams", () => {
    const set = makeSet({
      teamIds: [T('team_y')],
      workspace: [PERMISSIONS.TICKET_VIEW_SHARED],
    })
    expect(
      canViewTicket(set, {
        ...baseScope,
        primaryTeamId: T('team_x'),
        sharedTeamIds: [T('team_y')],
      })
    ).toBe(true)
  })

  it('grants via assigned scope when actor is the assignee', () => {
    const set = makeSet({
      principalId: P('user_a'),
      workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED],
    })
    expect(
      canViewTicket(set, {
        ...baseScope,
        assigneePrincipalId: P('user_a'),
      })
    ).toBe(true)
  })
})

describe('canReplyPublic / canEditFields / canShareCrossTeam', () => {
  const scope = {
    primaryTeamId: T('team_x'),
    assigneePrincipalId: null,
    assigneeTeamId: null,
    sharedTeamIds: [] as TeamId[],
  }

  it('canReplyPublic respects team-scoped grant', () => {
    const set = makeSet({ team: { team_x: [PERMISSIONS.TICKET_REPLY_PUBLIC] } })
    expect(canReplyPublic(set, scope)).toBe(true)
    const elsewhere = makeSet({ team: { team_y: [PERMISSIONS.TICKET_REPLY_PUBLIC] } })
    expect(canReplyPublic(elsewhere, scope)).toBe(false)
  })

  it('canEditFields requires the explicit permission', () => {
    const set = makeSet({ workspace: [PERMISSIONS.TICKET_REPLY_PUBLIC] })
    expect(canEditFields(set, scope)).toBe(false)
    const set2 = makeSet({ workspace: [PERMISSIONS.TICKET_EDIT_FIELDS] })
    expect(canEditFields(set2, scope)).toBe(true)
  })

  it('canShareCrossTeam is gated by share_cross_team', () => {
    const set = makeSet({ team: { team_x: [PERMISSIONS.TICKET_SHARE_CROSS_TEAM] } })
    expect(canShareCrossTeam(set, scope)).toBe(true)
    const noPerm = makeSet({ team: { team_x: [PERMISSIONS.TICKET_REPLY_PUBLIC] } })
    expect(canShareCrossTeam(noPerm, scope)).toBe(false)
  })

  it('canManageParticipants checks the explicit permission', () => {
    const yes = makeSet({ workspace: [PERMISSIONS.TICKET_MANAGE_PARTICIPANTS] })
    const no = makeSet({ workspace: [PERMISSIONS.TICKET_REPLY_PUBLIC] })
    expect(canManageParticipants(yes, scope)).toBe(true)
    expect(canManageParticipants(no, scope)).toBe(false)
  })
})

describe('canAssign / canAssignSelf', () => {
  const scope = {
    primaryTeamId: T('team_x'),
    assigneePrincipalId: null,
    assigneeTeamId: null,
    sharedTeamIds: [] as TeamId[],
  }

  it('canAssign requires assign_any (workspace or team)', () => {
    const ws = makeSet({ workspace: [PERMISSIONS.TICKET_ASSIGN_ANY] })
    expect(canAssign(ws, scope)).toBe(true)
    const teamScoped = makeSet({ team: { team_x: [PERMISSIONS.TICKET_ASSIGN_ANY] } })
    expect(canAssign(teamScoped, scope)).toBe(true)
    const onlySelf = makeSet({ workspace: [PERMISSIONS.TICKET_ASSIGN_SELF] })
    expect(canAssign(onlySelf, scope)).toBe(false)
  })

  it('canAssignSelf falls back to assign_self when assign_any missing', () => {
    const onlySelf = makeSet({ workspace: [PERMISSIONS.TICKET_ASSIGN_SELF] })
    expect(canAssignSelf(onlySelf, scope)).toBe(true)
  })
})
