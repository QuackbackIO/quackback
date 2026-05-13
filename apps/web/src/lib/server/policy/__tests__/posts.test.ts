/**
 * Exhaustive matrix for canViewPost and canCreatePost.
 *
 * Goals:
 *  - Every moderationState × audience × actor combination behaves as
 *    specified, with the author-of-own-pending escape hatch covered.
 *  - canCreatePost: every requireApproval value × every principalType ×
 *    trusted-bypass present/absent × team/non-team.
 *  - Author-pending recognition is principalId-equality, not falsy-equality
 *    (null !== null must NOT match).
 *
 * Pairs with boards.test.ts (audience matrix) and segment-membership tests.
 */
import { describe, it, expect } from 'vitest'
import { canViewPost, canCreatePost } from '../posts'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import type { BoardAudience, BoardModeration } from '@/lib/server/db'

// ----------------------------------------------------------------------
// Actor fixtures
// ----------------------------------------------------------------------

const admin: Actor = {
  principalId: 'p_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const member: Actor = {
  principalId: 'p_member' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}
const portal: Actor = {
  principalId: 'p_portal' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const trustedPortal: Actor = {
  principalId: 'p_trusted' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_trusted' as SegmentId]),
}
const anon = ANONYMOUS_ACTOR
const service: Actor = {
  principalId: 'p_svc' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(),
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

type ModerationState = 'published' | 'pending' | 'spam' | 'archived' | 'closed' | 'deleted'

const ALL_MODERATION_STATES: ModerationState[] = [
  'published',
  'pending',
  'spam',
  'archived',
  'closed',
  'deleted',
]

const publicBoard = { audience: { kind: 'public' } as BoardAudience }
const teamBoard = { audience: { kind: 'team' } as BoardAudience }
const authBoard = { audience: { kind: 'authenticated' } as BoardAudience }
const segBoard = {
  audience: { kind: 'segments', segmentIds: ['segment_trusted'] } as BoardAudience,
}

// ----------------------------------------------------------------------
// canViewPost — moderationState matrix on a viewable board
// ----------------------------------------------------------------------

describe('canViewPost — non-team viewer on a public board', () => {
  it.each([
    { state: 'published' as ModerationState, expected: true },
    { state: 'pending' as ModerationState, expected: false }, // not author
    { state: 'spam' as ModerationState, expected: false },
    { state: 'archived' as ModerationState, expected: false },
    { state: 'closed' as ModerationState, expected: false },
    { state: 'deleted' as ModerationState, expected: false },
  ])('moderationState=$state → allowed=$expected', ({ state, expected }) => {
    const decision = canViewPost(
      portal,
      { moderationState: state, principalId: 'p_other' as PrincipalId },
      publicBoard
    )
    expect(decision.allowed).toBe(expected)
  })
})

describe('canViewPost — team viewer sees everything except deleted', () => {
  it.each([
    { state: 'published' as ModerationState, expected: true },
    { state: 'pending' as ModerationState, expected: true },
    { state: 'spam' as ModerationState, expected: true },
    { state: 'archived' as ModerationState, expected: true },
    { state: 'closed' as ModerationState, expected: true },
    { state: 'deleted' as ModerationState, expected: false },
  ])('admin + state=$state → allowed=$expected', ({ state, expected }) => {
    expect(
      canViewPost(
        admin,
        { moderationState: state, principalId: 'p_other' as PrincipalId },
        publicBoard
      ).allowed
    ).toBe(expected)
  })

  it.each(ALL_MODERATION_STATES.filter((s) => s !== 'deleted'))(
    'member + state=%s → allowed',
    (state) => {
      expect(
        canViewPost(member, { moderationState: state, principalId: null }, publicBoard).allowed
      ).toBe(true)
    }
  )
})

describe('canViewPost — author-pending escape hatch', () => {
  it('author sees their own pending post', () => {
    expect(
      canViewPost(
        portal,
        { moderationState: 'pending', principalId: portal.principalId },
        publicBoard
      ).allowed
    ).toBe(true)
  })

  it('author does NOT see their own spam (only pending qualifies)', () => {
    expect(
      canViewPost(portal, { moderationState: 'spam', principalId: portal.principalId }, publicBoard)
        .allowed
    ).toBe(false)
  })

  it('author does NOT see their own archived', () => {
    expect(
      canViewPost(
        portal,
        { moderationState: 'archived', principalId: portal.principalId },
        publicBoard
      ).allowed
    ).toBe(false)
  })

  it('different actor with same string-shaped principalId does match (string equality)', () => {
    // Regression guard: principalId compare is value-based, not reference-based.
    const a: Actor = { ...portal, principalId: 'p_same' as PrincipalId }
    expect(
      canViewPost(
        a,
        { moderationState: 'pending', principalId: 'p_same' as PrincipalId },
        publicBoard
      ).allowed
    ).toBe(true)
  })

  it('null + null does NOT count as match (anonymous viewer cannot see anonymous-authored pending)', () => {
    // Critical: a falsy-equal check would let anyone see all anonymous pending posts.
    // The actor.principalId guard prevents that.
    expect(
      canViewPost(anon, { moderationState: 'pending', principalId: null }, publicBoard).allowed
    ).toBe(false)
  })

  it('portal viewer with null post.principalId does NOT match', () => {
    expect(
      canViewPost(portal, { moderationState: 'pending', principalId: null }, publicBoard).allowed
    ).toBe(false)
  })

  it('different principalIds do not match', () => {
    expect(
      canViewPost(
        portal,
        { moderationState: 'pending', principalId: 'p_other' as PrincipalId },
        publicBoard
      ).allowed
    ).toBe(false)
  })
})

describe('canViewPost — board denies first, post never inspected', () => {
  it('team-audience board denies any portal user before moderationState check', () => {
    const decision = canViewPost(
      portal,
      { moderationState: 'published', principalId: portal.principalId },
      teamBoard
    )
    expect(decision.allowed).toBe(false)
    // Reason comes from canViewBoard, not the moderation branch.
    if (!decision.allowed) expect(decision.reason.toLowerCase()).toContain('internal')
  })

  it('authenticated-audience board denies anonymous viewer regardless of moderationState', () => {
    for (const state of ALL_MODERATION_STATES) {
      const decision = canViewPost(
        anon,
        { moderationState: state, principalId: 'p_other' as PrincipalId },
        authBoard
      )
      expect(decision.allowed).toBe(false)
    }
  })

  it('segments-audience board denies non-member regardless of moderationState', () => {
    expect(
      canViewPost(
        portal,
        { moderationState: 'published', principalId: 'p_other' as PrincipalId },
        segBoard
      ).allowed
    ).toBe(false)
  })

  it('segments-audience board allows a segment-member to see published', () => {
    expect(
      canViewPost(
        trustedPortal,
        { moderationState: 'published', principalId: 'p_other' as PrincipalId },
        segBoard
      ).allowed
    ).toBe(true)
  })

  it('segments-audience board allows a segment-member to see their OWN pending', () => {
    expect(
      canViewPost(
        trustedPortal,
        { moderationState: 'pending', principalId: trustedPortal.principalId },
        segBoard
      ).allowed
    ).toBe(true)
  })
})

// ----------------------------------------------------------------------
// canCreatePost — exhaustive matrix
// ----------------------------------------------------------------------

const requireApprovalValues = ['none', 'anonymous', 'authenticated', 'all'] as const
type RequireApproval = (typeof requireApprovalValues)[number]

function moderation(requireApproval: RequireApproval, trusted: string[] = []): BoardModeration {
  return { requireApproval, trustedSegmentIds: trusted }
}

describe('canCreatePost — happy-path moderation matrix', () => {
  it.each([
    // anonymous submitter
    { ra: 'none' as RequireApproval, actor: anon, want: false },
    { ra: 'anonymous' as RequireApproval, actor: anon, want: true },
    { ra: 'authenticated' as RequireApproval, actor: anon, want: false }, // anon bypasses authenticated-only gating
    { ra: 'all' as RequireApproval, actor: anon, want: true },
    // signed-in portal user
    { ra: 'none' as RequireApproval, actor: portal, want: false },
    { ra: 'anonymous' as RequireApproval, actor: portal, want: false },
    { ra: 'authenticated' as RequireApproval, actor: portal, want: true },
    { ra: 'all' as RequireApproval, actor: portal, want: true },
    // service principal (non-team API key) — see DESIGN PIN below
    { ra: 'none' as RequireApproval, actor: service, want: false },
    { ra: 'anonymous' as RequireApproval, actor: service, want: true },
    { ra: 'authenticated' as RequireApproval, actor: service, want: false },
    { ra: 'all' as RequireApproval, actor: service, want: true },
  ])(
    'requireApproval=$ra + actor.principalType=$actor.principalType → requiresApproval=$want',
    ({ ra, actor, want }) => {
      const decision = canCreatePost(actor, {
        audience: { kind: 'public' },
        moderation: moderation(ra),
      })
      expect(decision.allowed).toBe(true)
      if (decision.allowed) expect(decision.requiresApproval).toBe(want)
    }
  )

  // ────────────────────────────────────────────────────────────────────
  // DESIGN PIN — service principalType on requireApproval='anonymous'
  //
  // The matrix above pins a current behaviour worth surfacing:
  //
  //   requireApproval='anonymous' + actor.principalType='service'
  //     → requiresApproval=true
  //
  // Why this happens: canCreatePost checks `principalType !== 'user'`,
  // which is true for both 'anonymous' AND 'service'. An authenticated
  // service principal (API key integration) therefore gets gated by
  // the same flag intended for unsigned portal sessions.
  //
  // Why this may be wrong: a service principal IS authenticated — it
  // just isn't a portal user. Treating it as anonymous-class for
  // moderation purposes is unintuitive; customers wiring up API-driven
  // post creation will hit moderation queues unexpectedly.
  //
  // Why we kept it: the alternative is a deliberate design decision
  // (extend requireApproval to a four-value enum that distinguishes
  // service from anonymous, or add a separate gateService flag). The
  // current behaviour fails *closed* (over-moderates rather than
  // under-moderates) so it ships safely; a v2 design call should be
  // driven by real customer feedback rather than guessed.
  //
  // TODO(v2): revisit when an integrator complains. Either treat
  // service as 'authenticated' for moderation, or add a separate
  // `boards.moderation.gateService: boolean` knob.
  // ────────────────────────────────────────────────────────────────────
  it('DESIGN PIN: service principalType is gated by requireApproval=anonymous (over-moderates)', () => {
    const decision = canCreatePost(service, {
      audience: { kind: 'public' },
      moderation: moderation('anonymous'),
    })
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })
})

describe('canCreatePost — team always bypasses approval', () => {
  it.each(requireApprovalValues)('admin + requireApproval=%s', (ra) => {
    expect(
      canCreatePost(admin, { audience: { kind: 'public' }, moderation: moderation(ra) })
    ).toEqual({ allowed: true, requiresApproval: false })
  })

  it.each(requireApprovalValues)('member + requireApproval=%s', (ra) => {
    expect(
      canCreatePost(member, { audience: { kind: 'public' }, moderation: moderation(ra) })
    ).toEqual({ allowed: true, requiresApproval: false })
  })
})

describe('canCreatePost — trusted-segment bypass', () => {
  it('trusted-segment member bypasses every requireApproval level', () => {
    for (const ra of requireApprovalValues) {
      expect(
        canCreatePost(trustedPortal, {
          audience: { kind: 'public' },
          moderation: moderation(ra, ['segment_trusted']),
        })
      ).toEqual({ allowed: true, requiresApproval: false })
    }
  })

  it('non-trusted-segment user is NOT bypassed by an unrelated trusted segment', () => {
    const decision = canCreatePost(portal, {
      audience: { kind: 'public' },
      moderation: moderation('all', ['segment_other']),
    })
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })

  it('trusted bypass only requires ANY listed segment to match', () => {
    const actor: Actor = {
      ...portal,
      segmentIds: new Set(['segment_a', 'segment_trusted'] as SegmentId[]),
    }
    expect(
      canCreatePost(actor, {
        audience: { kind: 'public' },
        moderation: moderation('all', ['segment_unrelated', 'segment_trusted']),
      })
    ).toEqual({ allowed: true, requiresApproval: false })
  })

  it('trusted-segment bypass works even when actor cannot otherwise view the board', () => {
    // segments-audience board: actor is in 'segment_trusted' so they CAN view AND bypass.
    expect(
      canCreatePost(trustedPortal, {
        audience: { kind: 'segments', segmentIds: ['segment_trusted'] },
        moderation: moderation('all', ['segment_trusted']),
      })
    ).toEqual({ allowed: true, requiresApproval: false })
  })
})

describe('canCreatePost — board view denied → create denied', () => {
  it('anonymous cannot post on authenticated-only board', () => {
    const decision = canCreatePost(anon, {
      audience: { kind: 'authenticated' },
      moderation: moderation('none'),
    })
    expect(decision.allowed).toBe(false)
  })

  it('portal user cannot post on team-only board', () => {
    const decision = canCreatePost(portal, {
      audience: { kind: 'team' },
      moderation: moderation('none'),
    })
    expect(decision.allowed).toBe(false)
  })

  it('portal user cannot post on segments-only board if they are not a member', () => {
    const decision = canCreatePost(portal, {
      audience: { kind: 'segments', segmentIds: ['segment_other'] },
      moderation: moderation('none'),
    })
    expect(decision.allowed).toBe(false)
  })
})

describe('canCreatePost — moderation defaults safely when undefined', () => {
  it('treats absent moderation as { requireApproval: none, trusted: [] }', () => {
    const decision = canCreatePost(portal, { audience: { kind: 'public' } })
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })

  it('absent moderation does not crash on missing trustedSegmentIds', () => {
    expect(() => canCreatePost(trustedPortal, { audience: { kind: 'public' } })).not.toThrow()
  })
})
