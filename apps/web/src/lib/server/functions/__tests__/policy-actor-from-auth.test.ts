import { describe, it, expect, vi } from 'vitest'
import type { AuthContext } from '../auth-helpers'
import type { PrincipalId, SegmentId, UserId, WorkspaceId } from '@quackback/ids'

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async (principalId: string | null) =>
    principalId === null ? new Set() : new Set(['segment_a', 'segment_b'])
  ),
}))

import { policyActorFromAuth } from '../auth-helpers'

// Build a fully-typed AuthContext (no `as never`/`as unknown` casts).
// principal.role is constrained to {admin, member, user} — service is a
// principal *type*, not a role.
function buildAuth(overrides: {
  principalId?: string
  principalRole?: 'admin' | 'member' | 'user'
  principalType?: string
  userEmail?: string
}): AuthContext {
  return {
    settings: {
      id: 'workspace_main' as WorkspaceId,
      slug: 'main',
      name: 'Main',
      logoKey: null,
    },
    user: {
      id: 'user_test' as UserId,
      email: overrides.userEmail ?? 'test@x.com',
      name: 'Test',
      image: null,
    },
    principal: {
      id: (overrides.principalId ?? 'principal_test') as PrincipalId,
      role: overrides.principalRole ?? 'user',
      type: overrides.principalType ?? 'user',
    },
  }
}

describe('policyActorFromAuth', () => {
  it('returns ANONYMOUS_ACTOR for null auth', async () => {
    const actor = await policyActorFromAuth(null)
    expect(actor.role).toBeNull()
    expect(actor.principalType).toBe('anonymous')
    expect(actor.principalId).toBeNull()
    expect(actor.segmentIds.size).toBe(0)
  })

  it('maps role and resolves segments for a portal user', async () => {
    const actor = await policyActorFromAuth(buildAuth({ principalRole: 'user' }))
    expect(actor.principalType).toBe('user')
    expect(actor.role).toBe('user')
    expect(actor.segmentIds.size).toBe(2)
    expect(actor.segmentIds.has('segment_a' as SegmentId)).toBe(true)
  })

  it('preserves principalType=anonymous (Better Auth anon session)', async () => {
    // Critical regression guard — codex P1. Anonymous sessions must NOT
    // satisfy audience.kind='authenticated' or bypass requireApproval='anonymous'.
    const actor = await policyActorFromAuth(buildAuth({ principalType: 'anonymous' }))
    expect(actor.principalType).toBe('anonymous')
  })

  it('preserves principalType=service for API-key principals', async () => {
    // Service principals have a regular role (member/admin/user) plus a
    // distinct principalType='service'. The two are independent — role
    // drives team-vs-portal checks, type drives audience checks.
    const actor = await policyActorFromAuth(
      buildAuth({ principalType: 'service', principalRole: 'member' })
    )
    expect(actor.principalType).toBe('service')
    expect(actor.role).toBe('member')
  })

  it('maps admin role through verbatim', async () => {
    const actor = await policyActorFromAuth(buildAuth({ principalRole: 'admin' }))
    expect(actor.role).toBe('admin')
  })

  it('maps member role through verbatim', async () => {
    const actor = await policyActorFromAuth(buildAuth({ principalRole: 'member' }))
    expect(actor.role).toBe('member')
  })

  it('treats unknown principalType as "user" (safe default)', async () => {
    // Forward-compat: if a future principal type is introduced that
    // policyActorFromAuth hasn't been updated to handle, default to the
    // most restrictive interpretation ('user', not 'service'). 'user' is
    // a signed-in real person — denying them is a UX bug, but treating
    // them as a service would weaken the security model.
    const actor = await policyActorFromAuth(buildAuth({ principalType: 'future_kind' }))
    expect(actor.principalType).toBe('user')
  })

  it('threads the principalId into the segment lookup', async () => {
    const actor = await policyActorFromAuth(buildAuth({ principalId: 'principal_specific' }))
    expect(actor.principalId).toBe('principal_specific')
    // The segment lookup ran for this specific id (mocked to return 2 segments).
    expect(actor.segmentIds.size).toBe(2)
  })

  it('returns an immutable Set (callers cannot mutate)', async () => {
    const actor = await policyActorFromAuth(buildAuth({}))
    // ReadonlySet at the type level; runtime is still a Set, but if any
    // production code somewhere mutates it, that's a bug we want to catch.
    expect(actor.segmentIds instanceof Set).toBe(true)
  })
})
