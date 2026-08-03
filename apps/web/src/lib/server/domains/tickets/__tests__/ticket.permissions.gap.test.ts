/**
 * ticket.permissions — gap tests for canCommentInternal and the
 * undefined-shares branch of toResourceScope.
 */
import { describe, it, expect } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '../../authz'
import type { PermissionSet } from '../../authz/authz.service'
import type { PrincipalId, TeamId } from '@quackback/ids'
import { canCommentInternal, toResourceScope } from '../ticket.permissions'

const P = (s: string) => s as unknown as PrincipalId
const T = (s: string) => s as unknown as TeamId

function makeSet(opts: {
  workspace?: PermissionKey[]
  team?: Record<string, PermissionKey[]>
}): PermissionSet {
  const teamPermissions = new Map<TeamId, ReadonlySet<PermissionKey>>()
  for (const [k, v] of Object.entries(opts.team ?? {})) {
    teamPermissions.set(T(k), new Set(v))
  }
  return {
    principalId: P('user_a'),
    workspacePermissions: new Set(opts.workspace ?? []),
    teamPermissions,
    teamIds: Object.keys(opts.team ?? {}).map(T),
  }
}

const scope = {
  primaryTeamId: T('team_x'),
  assigneePrincipalId: null,
  assigneeTeamId: null,
  sharedTeamIds: [] as TeamId[],
}

describe('canCommentInternal', () => {
  it('requires the comment_internal permission', () => {
    const yes = makeSet({ workspace: [PERMISSIONS.TICKET_COMMENT_INTERNAL] })
    const no = makeSet({ workspace: [PERMISSIONS.TICKET_REPLY_PUBLIC] })
    expect(canCommentInternal(yes, scope)).toBe(true)
    expect(canCommentInternal(no, scope)).toBe(false)
  })
})

describe('toResourceScope', () => {
  it('defaults sharedTeamIds to empty when shares is undefined', () => {
    const result = toResourceScope({
      primaryTeamId: T('team_x'),
      assigneePrincipalId: null,
      assigneeTeamId: null,
    })
    expect(result.sharedTeamIds).toEqual([])
  })
})
