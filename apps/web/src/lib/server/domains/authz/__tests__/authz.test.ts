/**
 * Pure-logic tests for the authz scope evaluator and permission helpers.
 *
 * These tests do not touch the database — they exercise the pure functions
 * exported from `authz.scopes.ts` and `authz.service.ts` so we can verify the
 * full role × action × scope matrix without a live workspace.
 */
import { describe, it, expect } from 'vitest'
import type { PermissionSet } from '../authz.service'
import { evaluateTicketView, hasPermission, hasPermissionForResource } from '../authz.service'
import { matchesAssignedScope, matchesSharedScope, matchesTeamScope } from '../authz.scopes'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '../authz.permissions'
import type { PrincipalId, TeamId } from '@quackback/ids'

const PRINCIPAL_A = 'principal_aaaaaaaaaaaaaaaaaaaaaaaaaa' as PrincipalId
const PRINCIPAL_B = 'principal_bbbbbbbbbbbbbbbbbbbbbbbbbb' as PrincipalId
const TEAM_X = 'team_xxxxxxxxxxxxxxxxxxxxxxxxxx' as TeamId
const TEAM_Y = 'team_yyyyyyyyyyyyyyyyyyyyyyyyyy' as TeamId
const TEAM_Z = 'team_zzzzzzzzzzzzzzzzzzzzzzzzzz' as TeamId

function buildSet(args: {
  principalId?: PrincipalId
  workspace?: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][]
  team?: Record<TeamId, readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][]>
  teamIds?: readonly TeamId[]
}): PermissionSet {
  const teamPermissions = new Map(
    Object.entries(args.team ?? {}).map(([k, v]) => [k as TeamId, new Set(v)])
  )
  return {
    principalId: args.principalId ?? PRINCIPAL_A,
    workspacePermissions: new Set(args.workspace ?? []),
    teamPermissions,
    teamIds: args.teamIds ?? [],
  }
}

describe('authz scope helpers', () => {
  it('matches assigned scope when principal is the assignee', () => {
    expect(
      matchesAssignedScope(
        { principalId: PRINCIPAL_A, teamIds: [] },
        { assigneePrincipalId: PRINCIPAL_A }
      ).inScope
    ).toBe(true)
  })

  it('does not match assigned scope for a different principal', () => {
    expect(
      matchesAssignedScope(
        { principalId: PRINCIPAL_A, teamIds: [] },
        { assigneePrincipalId: PRINCIPAL_B }
      ).inScope
    ).toBe(false)
  })

  it('matches team scope by primary or assignee team', () => {
    expect(
      matchesTeamScope({ principalId: PRINCIPAL_A, teamIds: [TEAM_X] }, { primaryTeamId: TEAM_X })
        .inScope
    ).toBe(true)
    expect(
      matchesTeamScope({ principalId: PRINCIPAL_A, teamIds: [TEAM_X] }, { assigneeTeamId: TEAM_X })
        .inScope
    ).toBe(true)
    expect(
      matchesTeamScope({ principalId: PRINCIPAL_A, teamIds: [TEAM_X] }, { primaryTeamId: TEAM_Y })
        .inScope
    ).toBe(false)
  })

  it('matches shared scope when one of the actor teams is in shared list', () => {
    expect(
      matchesSharedScope(
        { principalId: PRINCIPAL_A, teamIds: [TEAM_X, TEAM_Y] },
        { sharedTeamIds: [TEAM_Y, TEAM_Z] }
      ).inScope
    ).toBe(true)
  })

  it('shared scope returns none when no overlap', () => {
    expect(
      matchesSharedScope(
        { principalId: PRINCIPAL_A, teamIds: [TEAM_X] },
        { sharedTeamIds: [TEAM_Y] }
      ).inScope
    ).toBe(false)
  })
})

describe('hasPermission / hasPermissionForResource', () => {
  it('workspace-wide grants always match regardless of resource', () => {
    const set = buildSet({ workspace: [PERMISSIONS.TICKET_REPLY_PUBLIC] })
    expect(hasPermission(set, PERMISSIONS.TICKET_REPLY_PUBLIC)).toBe(true)
    expect(
      hasPermissionForResource(set, PERMISSIONS.TICKET_REPLY_PUBLIC, {
        primaryTeamId: TEAM_Y,
      })
    ).toBe(true)
  })

  it('team-scoped grants only match resources within the granted team', () => {
    const set = buildSet({
      team: { [TEAM_X]: [PERMISSIONS.TICKET_REPLY_PUBLIC] },
      teamIds: [TEAM_X],
    })
    expect(
      hasPermissionForResource(set, PERMISSIONS.TICKET_REPLY_PUBLIC, {
        primaryTeamId: TEAM_X,
      })
    ).toBe(true)
    expect(
      hasPermissionForResource(set, PERMISSIONS.TICKET_REPLY_PUBLIC, {
        primaryTeamId: TEAM_Y,
      })
    ).toBe(false)
  })

  it('team-scoped grants apply to shared-with team', () => {
    const set = buildSet({
      team: { [TEAM_X]: [PERMISSIONS.TICKET_REPLY_PUBLIC] },
    })
    expect(
      hasPermissionForResource(set, PERMISSIONS.TICKET_REPLY_PUBLIC, {
        sharedTeamIds: [TEAM_X],
      })
    ).toBe(true)
  })

  it('returns false when the permission is absent everywhere', () => {
    const set = buildSet({})
    expect(hasPermission(set, PERMISSIONS.TICKET_REPLY_PUBLIC)).toBe(false)
  })
})

describe('evaluateTicketView (broadest → narrowest)', () => {
  it('view_all wins regardless of resource', () => {
    const set = buildSet({ workspace: [PERMISSIONS.TICKET_VIEW_ALL] })
    const m = evaluateTicketView(set, { primaryTeamId: TEAM_Y })
    expect(m.inScope).toBe(true)
    expect(m.reason).toBe('all')
  })

  it('view_team matches when actor is on the owning team', () => {
    const set = buildSet({
      workspace: [PERMISSIONS.TICKET_VIEW_TEAM],
      teamIds: [TEAM_X],
    })
    const m = evaluateTicketView(set, { primaryTeamId: TEAM_X })
    expect(m).toEqual({ inScope: true, reason: 'team' })
  })

  it('view_team does not match a foreign team without view_shared', () => {
    const set = buildSet({
      workspace: [PERMISSIONS.TICKET_VIEW_TEAM],
      teamIds: [TEAM_X],
    })
    const m = evaluateTicketView(set, { primaryTeamId: TEAM_Y })
    expect(m.inScope).toBe(false)
  })

  it('view_shared matches when ticket is shared with one of actor teams', () => {
    const set = buildSet({
      workspace: [PERMISSIONS.TICKET_VIEW_SHARED],
      teamIds: [TEAM_X],
    })
    const m = evaluateTicketView(set, {
      primaryTeamId: TEAM_Y,
      sharedTeamIds: [TEAM_X],
    })
    expect(m).toEqual({ inScope: true, reason: 'shared' })
  })

  it('view_assigned matches only when principal is the assignee', () => {
    const set = buildSet({
      workspace: [PERMISSIONS.TICKET_VIEW_ASSIGNED],
      principalId: PRINCIPAL_A,
    })
    expect(evaluateTicketView(set, { assigneePrincipalId: PRINCIPAL_A })).toEqual({
      inScope: true,
      reason: 'assigned',
    })
    expect(evaluateTicketView(set, { assigneePrincipalId: PRINCIPAL_B })).toEqual({
      inScope: false,
      reason: 'none',
    })
  })

  it('returns inScope=false with reason=none when no permission applies', () => {
    const set = buildSet({})
    const m = evaluateTicketView(set, { primaryTeamId: TEAM_X })
    expect(m).toEqual({ inScope: false, reason: 'none' })
  })
})

describe('system role bundles', () => {
  it('owner holds every permission', () => {
    const owner = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.OWNER]
    for (const p of Object.values(PERMISSIONS)) {
      expect(owner).toContain(p)
    }
  })

  it('agent does NOT have view_all or assign_any', () => {
    const agent = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.AGENT]
    expect(agent).not.toContain(PERMISSIONS.TICKET_VIEW_ALL)
    expect(agent).not.toContain(PERMISSIONS.TICKET_ASSIGN_ANY)
    expect(agent).not.toContain(PERMISSIONS.TICKET_SHARE_CROSS_TEAM)
    expect(agent).not.toContain(PERMISSIONS.AUDIT_VIEW)
  })

  it('collaborator has internal-comment but no public reply', () => {
    const c = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.COLLABORATOR]
    expect(c).toContain(PERMISSIONS.TICKET_COMMENT_INTERNAL)
    expect(c).not.toContain(PERMISSIONS.TICKET_REPLY_PUBLIC)
  })

  it('customer has no internal-side permissions', () => {
    expect(SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.CUSTOMER]).toHaveLength(0)
  })
})
