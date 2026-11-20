/**
 * teamActorFromAuth builds the actor for a teammate holding post.view_private
 * with no segment lookup (the post and board view filters never read segments
 * for such an actor), and returns null for anyone else, who must go through
 * policyActorFromAuth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId, WorkspaceId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { AuthContext } from '../auth-helpers'

const segmentIdsForPrincipal = vi.hoisted(() => vi.fn(async () => new Set(['segment_a'])))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal,
}))

import { teamActorFromAuth } from '../auth-helpers'

function auth(
  role: 'admin' | 'member' | 'user',
  permissions: PermissionKey[],
  type = 'user'
): AuthContext {
  return {
    settings: { id: 'workspace_main' as WorkspaceId, slug: 'main', name: 'Main', logoKey: null },
    user: { id: 'user_test' as UserId, email: 't@x.com', name: 'Test', image: null },
    principal: { id: 'principal_test' as PrincipalId, role, type },
    permissions,
    scope: 'dashboard',
  }
}

beforeEach(() => segmentIdsForPrincipal.mockClear())

describe('teamActorFromAuth', () => {
  it('builds a teammate holding post.view_private without reading segments', () => {
    const actor = teamActorFromAuth(auth('member', [PERMISSIONS.POST_VIEW_PRIVATE]))

    expect(actor).toMatchObject({
      principalId: 'principal_test',
      role: 'member',
      principalType: 'user',
    })
    expect(actor?.segmentIds.size).toBe(0)
    expect(actor?.permissions?.has(PERMISSIONS.POST_VIEW_PRIVATE)).toBe(true)
    expect(segmentIdsForPrincipal).not.toHaveBeenCalled()
  })

  it('returns null for a teammate without post.view_private', () => {
    expect(teamActorFromAuth(auth('member', [PERMISSIONS.POST_CREATE]))).toBeNull()
  })

  it('returns null for a portal user, an anonymous session and no session', () => {
    expect(teamActorFromAuth(auth('user', [PERMISSIONS.POST_VIEW_PRIVATE]))).toBeNull()
    expect(
      teamActorFromAuth(auth('admin', [PERMISSIONS.POST_VIEW_PRIVATE], 'anonymous'))
    ).toBeNull()
    expect(teamActorFromAuth(null)).toBeNull()
  })
})
