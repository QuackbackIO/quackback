/**
 * Exhaustive matrix for canViewPost and canCreatePost.
 *
 * Goals:
 *  - Every moderationState × audience × actor combination behaves as
 *    specified, with the author-of-own-pending escape hatch covered.
 *  - canCreatePost: every workspace requireApproval value × every
 *    principalType × team/non-team.
 *  - Author-pending recognition is principalId-equality, not falsy-equality
 *    (null !== null must NOT match).
 *
 * Pairs with boards.test.ts (audience matrix) and segment-membership tests.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { canViewPost, canCreatePost, canCreateComment, canVotePost } from '../posts'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import type { AccessTier, BoardAccess, ModerationState } from '@/lib/server/db'
import { MODERATION_STATES } from '@/lib/server/db'

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

const ALL_MODERATION_STATES = [...MODERATION_STATES]

// Equivalent BoardAccess shapes for the four legacy audience kinds. The
// mapping mirrors audienceToAccess() in board.service — same tier on every
// action, all moderation rules inherit, segment list shared across all
// three actions — so the moderation-state matrix stays meaningful.
const mkAccess = (view: BoardAccess['view'], segmentIds: string[] = []): BoardAccess => ({
  view,
  vote: view,
  comment: view,
  submit: view,
  segments: {
    view: segmentIds,
    vote: segmentIds,
    comment: segmentIds,
    submit: segmentIds,
  },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
})

const publicBoard = { access: mkAccess('anonymous') }
const teamBoard = { access: mkAccess('team') }
const authBoard = { access: mkAccess('authenticated') }
const segBoard = { access: mkAccess('segments', ['segment_trusted']) }

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

describe('canCreatePost — happy-path moderation matrix (workspace policy)', () => {
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
      const decision = canCreatePost(actor, publicBoard, ra)
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
  // service from anonymous). The current behaviour fails *closed*
  // (over-moderates rather than under-moderates) so it ships safely;
  // a v2 design call should be driven by real customer feedback
  // rather than guessed.
  //
  // TODO(v2): revisit when an integrator complains. Either treat
  // service as 'authenticated' for moderation, or distinguish it
  // from anonymous in the workspace policy enum.
  // ────────────────────────────────────────────────────────────────────
  it('DESIGN PIN: service principalType is gated by requireApproval=anonymous (over-moderates)', () => {
    const decision = canCreatePost(service, publicBoard, 'anonymous')
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })
})

describe('canCreatePost — team always bypasses approval', () => {
  it.each(requireApprovalValues)('admin + requireApproval=%s', (ra) => {
    expect(canCreatePost(admin, publicBoard, ra)).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })

  it.each(requireApprovalValues)('member + requireApproval=%s', (ra) => {
    expect(canCreatePost(member, publicBoard, ra)).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })
})

describe('canCreatePost — board view denied → create denied', () => {
  it('anonymous cannot post on authenticated-only board', () => {
    const decision = canCreatePost(anon, authBoard, 'none')
    expect(decision.allowed).toBe(false)
  })

  it('portal user cannot post on team-only board', () => {
    const decision = canCreatePost(portal, teamBoard, 'none')
    expect(decision.allowed).toBe(false)
  })

  it('portal user cannot post on segments-only board if they are not a member', () => {
    const decision = canCreatePost(
      portal,
      { access: mkAccess('segments', ['segment_other']) },
      'none'
    )
    expect(decision.allowed).toBe(false)
  })
})

describe('canCreatePost — global default treated as none when undefined', () => {
  it('an absent workspace policy resolves to no approval required', () => {
    const decision = canCreatePost(portal, publicBoard, undefined)
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })

  it('an anonymous submitter with an absent policy is not gated', () => {
    const decision = canCreatePost(anon, publicBoard, undefined)
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })
})

describe('canCreatePost — tri-state moderation rules resolve against workspace', () => {
  const adminAccess = (
    overrides: Partial<BoardAccess['moderation']> = {}
  ): { access: BoardAccess } => ({
    access: {
      view: 'anonymous' as AccessTier,
      vote: 'anonymous' as AccessTier,
      comment: 'anonymous' as AccessTier,
      submit: 'anonymous' as AccessTier,
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: {
        anonPosts: 'inherit',
        signedPosts: 'inherit',
        comments: 'inherit',
        ...overrides,
      },
    },
  })

  it("anonPosts='on' holds anonymous posts even when workspace=none", () => {
    const decision = canCreatePost(anon, adminAccess({ anonPosts: 'on' }), 'none')
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })

  it("signedPosts='on' holds signed-in posts even when workspace=none", () => {
    const decision = canCreatePost(portal, adminAccess({ signedPosts: 'on' }), 'none')
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })

  it("signedPosts='off' overrides workspace=all (board says publish signed-in posts)", () => {
    // Board explicitly opts out of moderation for signed-in users, even
    // though workspace=all would otherwise gate them.
    const decision = canCreatePost(portal, adminAccess({ signedPosts: 'off' }), 'all')
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })

  it("anonPosts='off' overrides workspace=all for anonymous", () => {
    const decision = canCreatePost(anon, adminAccess({ anonPosts: 'off' }), 'all')
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })

  it("anonPosts='inherit' + workspace='anonymous' + anon → held", () => {
    const decision = canCreatePost(anon, adminAccess({ anonPosts: 'inherit' }), 'anonymous')
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })

  it("signedPosts='inherit' + workspace='authenticated' + signed-in → held", () => {
    const decision = canCreatePost(portal, adminAccess({ signedPosts: 'inherit' }), 'authenticated')
    expect(decision).toEqual({ allowed: true, requiresApproval: true })
  })

  it("moderation='on' does NOT hold team submissions (team always bypasses)", () => {
    const decision = canCreatePost(
      admin,
      adminAccess({ anonPosts: 'on', signedPosts: 'on' }),
      'none'
    )
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })

  it('all-inherit + workspace=none does not hold', () => {
    const decision = canCreatePost(portal, adminAccess(), 'none')
    expect(decision).toEqual({ allowed: true, requiresApproval: false })
  })
})

describe('canCreatePost — board.access.submit tier gates submission independent of view', () => {
  it('rejects portal user when submit=team but view=anonymous (admin-curated board)', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreatePost(portal, board, 'none').allowed).toBe(false)
  })

  it('rejects anonymous when submit=authenticated but view=anonymous', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'authenticated',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreatePost(anon, board, 'none').allowed).toBe(false)
  })

  it('admits portal user when submit=authenticated', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'authenticated',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreatePost(portal, board, 'none').allowed).toBe(true)
  })

  it('rejects portal user not in segment when submit=segments', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'segments',
        segments: { view: [], vote: [], comment: [], submit: ['segment_x'] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreatePost(portal, board, 'none').allowed).toBe(false)
  })

  // Invariant guard: submit is allowed ONLY if the actor can also VIEW the
  // board. The schema enforces submit.rank >= view.rank but allows the
  // per-action segment lists to differ — so a member of the submit segment
  // who is NOT in the view segment satisfies the submit tier yet cannot see
  // the board. canCreatePost must still deny (a post on a board you can't
  // view contradicts the file invariant + mirrors canVotePost/canCreateComment).
  it('rejects a submit-segment member who is not in the view segment', () => {
    const board = {
      access: {
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: {
          view: ['segment_other'],
          vote: ['segment_other'],
          comment: ['segment_other'],
          submit: ['segment_trusted'],
        },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    // trustedPortal is in segment_trusted (submit) but NOT segment_other (view).
    expect(canCreatePost(trustedPortal, board, 'none').allowed).toBe(false)
  })
})

// ----------------------------------------------------------------------
// canCreateComment
// ----------------------------------------------------------------------

describe('canCreateComment — board access gate', () => {
  const publishedPost = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
    isCommentsLocked: false,
  }

  it('portal user CANNOT comment on a post in a team-audience board', () => {
    expect(canCreateComment(portal, publishedPost, teamBoard, 'none').allowed).toBe(false)
  })

  it('portal user CANNOT comment in a segments board they are not in', () => {
    expect(canCreateComment(portal, publishedPost, segBoard, 'none').allowed).toBe(false)
  })

  it('segment-member CAN comment in their segments board', () => {
    expect(canCreateComment(trustedPortal, publishedPost, segBoard, 'none').allowed).toBe(true)
  })

  it('anonymous user CANNOT comment in an authenticated-audience board', () => {
    expect(canCreateComment(anon, publishedPost, authBoard, 'none').allowed).toBe(false)
  })

  it('portal user CAN comment on a published post in a public board', () => {
    expect(canCreateComment(portal, publishedPost, publicBoard, 'none').allowed).toBe(true)
  })
})

describe('canCreateComment — post visibility gate', () => {
  it("portal user CANNOT comment on another user's pending post", () => {
    const pendingPost = {
      moderationState: 'pending' as ModerationState,
      principalId: 'p_other' as PrincipalId,
      isCommentsLocked: false,
    }
    expect(canCreateComment(portal, pendingPost, publicBoard, 'none').allowed).toBe(false)
  })

  it('portal user CAN comment on their own pending post', () => {
    const ownPendingPost = {
      moderationState: 'pending' as ModerationState,
      principalId: portal.principalId,
      isCommentsLocked: false,
    }
    expect(canCreateComment(portal, ownPendingPost, publicBoard, 'none').allowed).toBe(true)
  })

  it('team member CAN comment on any non-deleted post (including pending)', () => {
    const pendingPost = {
      moderationState: 'pending' as ModerationState,
      principalId: 'p_other' as PrincipalId,
      isCommentsLocked: false,
    }
    expect(canCreateComment(admin, pendingPost, publicBoard, 'none').allowed).toBe(true)
    expect(canCreateComment(member, pendingPost, publicBoard, 'none').allowed).toBe(true)
  })
})

describe('canCreateComment — isCommentsLocked gate', () => {
  const lockedPost = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
    isCommentsLocked: true,
  }

  it('portal user CANNOT comment when isCommentsLocked=true', () => {
    const decision = canCreateComment(portal, lockedPost, publicBoard, 'none')
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toMatch(/locked/i)
  })

  it('anonymous user CANNOT comment when isCommentsLocked=true', () => {
    expect(canCreateComment(anon, lockedPost, publicBoard, 'none').allowed).toBe(false)
  })

  it('admin CAN comment even when isCommentsLocked=true', () => {
    expect(canCreateComment(admin, lockedPost, publicBoard, 'none').allowed).toBe(true)
  })

  it('member CAN comment even when isCommentsLocked=true', () => {
    expect(canCreateComment(member, lockedPost, publicBoard, 'none').allowed).toBe(true)
  })
})

describe('canCreateComment — board.access.comment tier gates commenting independent of view', () => {
  const publishedPost = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
    isCommentsLocked: false,
  }

  it('rejects anon when comment=authenticated even if view=anonymous', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'authenticated',
        submit: 'authenticated',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreateComment(anon, publishedPost, board, 'none').allowed).toBe(false)
  })

  it('rejects portal user when comment=team even if view=anonymous', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreateComment(portal, publishedPost, board, 'none').allowed).toBe(false)
  })

  it('admits team regardless of tier', () => {
    const board = {
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreateComment(admin, publishedPost, board, 'none').allowed).toBe(true)
  })

  it('rejects portal user not in segment when comment=segments', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'segments',
        submit: 'segments',
        segments: { view: [], vote: [], comment: ['segment_x'], submit: ['segment_x'] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canCreateComment(portal, publishedPost, board, 'none').allowed).toBe(false)
  })
})

describe('canCreateComment — tri-state moderation.comments resolves against workspace', () => {
  const publishedPost = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
    isCommentsLocked: false,
  }

  const mkBoard = (comments: BoardAccess['moderation']['comments']) => ({
    access: {
      view: 'anonymous',
      vote: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments },
    } satisfies BoardAccess,
  })

  it("non-team comments are held when moderation.comments='on'", () => {
    expect(canCreateComment(portal, publishedPost, mkBoard('on'), 'none')).toEqual({
      allowed: true,
      requiresApproval: true,
    })
  })

  it("team comments are NEVER held even when moderation.comments='on'", () => {
    expect(canCreateComment(admin, publishedPost, mkBoard('on'), 'none')).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })

  it("moderation.comments='off' overrides workspace='all' (board says publish comments)", () => {
    expect(canCreateComment(portal, publishedPost, mkBoard('off'), 'all')).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })

  it("moderation.comments='inherit' + workspace='all' → held", () => {
    expect(canCreateComment(portal, publishedPost, mkBoard('inherit'), 'all')).toEqual({
      allowed: true,
      requiresApproval: true,
    })
  })

  it("moderation.comments='inherit' + workspace='anonymous' → NOT held (comment axis only flips on 'all')", () => {
    // Today's workspace setting doesn't distinguish post- from comment-
    // moderation; per the resolveModerationRule docs, comments only
    // inherit-resolve to 'on' when workspace='all'.
    expect(canCreateComment(portal, publishedPost, mkBoard('inherit'), 'anonymous')).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })

  it("moderation.comments='inherit' + workspace='none' → NOT held", () => {
    expect(canCreateComment(portal, publishedPost, mkBoard('inherit'), 'none')).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })
})

// ----------------------------------------------------------------------
// canVotePost — per-board vote tier matrix
// ----------------------------------------------------------------------

describe('canVotePost — per-board vote tier', () => {
  const publishedPost = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
  }

  // The modern "Public" preset: anyone can read, but you must sign in
  // to vote.
  const publicViewAuthVoteBoard = {
    access: {
      view: 'anonymous',
      vote: 'authenticated',
      comment: 'anonymous',
      submit: 'authenticated',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    } satisfies BoardAccess,
  }

  it('denies anonymous actor on board.vote=authenticated with sign-in hint', () => {
    const decision = canVotePost(anon, publishedPost, publicViewAuthVoteBoard)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toMatch(/sign in/i)
  })

  it('allows authenticated actor on board.vote=authenticated', () => {
    expect(canVotePost(portal, publishedPost, publicViewAuthVoteBoard).allowed).toBe(true)
  })

  it('allows anonymous actor on board.vote=anonymous', () => {
    expect(canVotePost(anon, publishedPost, publicBoard).allowed).toBe(true)
  })

  it('denies a viewer who fails the view tier (composes canViewPost)', () => {
    // anon on view=authenticated board: canViewPost denies first, so the
    // resulting decision carries the view-deny reason rather than a vote
    // hint. The point: a viewer who can't see the post can never vote on
    // it regardless of vote tier.
    const decision = canVotePost(anon, publishedPost, authBoard)
    expect(decision.allowed).toBe(false)
    // Reason comes from canViewBoard, not the vote branch.
    if (!decision.allowed) expect(decision.reason).not.toMatch(/sign in to vote/i)
  })

  it('allows admin on any board (team always passes both gates)', () => {
    const decision = canVotePost(admin, publishedPost, {
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    })
    expect(decision.allowed).toBe(true)
  })

  it('allows member on a board with vote=team', () => {
    expect(
      canVotePost(member, publishedPost, {
        access: {
          view: 'anonymous',
          vote: 'team',
          comment: 'anonymous',
          submit: 'anonymous',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        } satisfies BoardAccess,
      }).allowed
    ).toBe(true)
  })

  it('allows an actor in the vote segment when board.vote=segments', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'segments',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: ['segment_trusted'], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    expect(canVotePost(trustedPortal, publishedPost, board).allowed).toBe(true)
  })

  it('denies an actor not in the vote segment when board.vote=segments', () => {
    const board = {
      access: {
        view: 'anonymous',
        vote: 'segments',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: ['segment_other'], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      } satisfies BoardAccess,
    }
    const decision = canVotePost(portal, publishedPost, board)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toMatch(/groups/i)
  })

  it('denies viewing a non-published post for non-team (composes canViewPost)', () => {
    // Even if vote tier allows, the actor must still be able to view the
    // post. A pending post by another author is invisible → vote denied.
    const pendingPost = {
      moderationState: 'pending' as ModerationState,
      principalId: 'p_other' as PrincipalId,
    }
    expect(canVotePost(portal, pendingPost, publicBoard).allowed).toBe(false)
  })
})

// ----------------------------------------------------------------------
// resolveModerationRule truth table
// ----------------------------------------------------------------------

describe('resolveModerationRule', () => {
  // Defer import so the previous mocks don't shadow it.
  let resolveModerationRule: typeof import('../posts').resolveModerationRule

  beforeAll(async () => {
    ;({ resolveModerationRule } = await import('../posts'))
  })

  describe('explicit overrides bypass workspace default', () => {
    it.each(['none', 'anonymous', 'authenticated', 'all'] as const)(
      "rule='on' + workspace=%s → 'on'",
      (ws) => {
        expect(resolveModerationRule('on', ws, 'anonPosts')).toBe('on')
        expect(resolveModerationRule('on', ws, 'signedPosts')).toBe('on')
        expect(resolveModerationRule('on', ws, 'comments')).toBe('on')
      }
    )

    it.each(['none', 'anonymous', 'authenticated', 'all'] as const)(
      "rule='off' + workspace=%s → 'off'",
      (ws) => {
        expect(resolveModerationRule('off', ws, 'anonPosts')).toBe('off')
        expect(resolveModerationRule('off', ws, 'signedPosts')).toBe('off')
        expect(resolveModerationRule('off', ws, 'comments')).toBe('off')
      }
    )

    it('on/off short-circuit fires before workspace is coalesced (undefined workspace)', () => {
      // The override branch must return before the `?? 'none'` coalescing, so
      // an undefined workspace policy never reaches an explicit rule.
      expect(resolveModerationRule('on', undefined, 'comments')).toBe('on')
      expect(resolveModerationRule('on', undefined, 'anonPosts')).toBe('on')
      expect(resolveModerationRule('off', undefined, 'signedPosts')).toBe('off')
    })
  })

  describe('inherit resolution per axis', () => {
    it.each([
      // anonPosts: on when workspace ∈ {'all', 'anonymous'}
      { ws: 'none', axis: 'anonPosts', want: 'off' },
      { ws: 'anonymous', axis: 'anonPosts', want: 'on' },
      { ws: 'authenticated', axis: 'anonPosts', want: 'off' },
      { ws: 'all', axis: 'anonPosts', want: 'on' },
      // signedPosts: on when workspace ∈ {'all', 'authenticated'}
      { ws: 'none', axis: 'signedPosts', want: 'off' },
      { ws: 'anonymous', axis: 'signedPosts', want: 'off' },
      { ws: 'authenticated', axis: 'signedPosts', want: 'on' },
      { ws: 'all', axis: 'signedPosts', want: 'on' },
      // comments: on only when workspace='all' (see resolveModerationRule
      // docs — workspace setting doesn't yet distinguish post- vs comment-
      // moderation, so comments inherit-resolve to on only on the strictest
      // workspace value)
      { ws: 'none', axis: 'comments', want: 'off' },
      { ws: 'anonymous', axis: 'comments', want: 'off' },
      { ws: 'authenticated', axis: 'comments', want: 'off' },
      { ws: 'all', axis: 'comments', want: 'on' },
    ] as const)('inherit + workspace=$ws + axis=$axis → $want', ({ ws, axis, want }) => {
      expect(resolveModerationRule('inherit', ws, axis)).toBe(want)
    })

    it("inherit + workspace=undefined treated as 'none'", () => {
      expect(resolveModerationRule('inherit', undefined, 'anonPosts')).toBe('off')
      expect(resolveModerationRule('inherit', undefined, 'signedPosts')).toBe('off')
      expect(resolveModerationRule('inherit', undefined, 'comments')).toBe('off')
    })
  })
})

// ======================================================================
// Audit gap-fill — the `service` principal class and gate-precedence /
// ownership edges the canonical matrices above leave unpinned. Reuses the
// admin/member/portal/trustedPortal/anon/service fixtures + mkAccess.
// ======================================================================

describe('canViewPost — service principal is non-team', () => {
  it('sees published on a viewable board', () => {
    expect(
      canViewPost(
        service,
        { moderationState: 'published', principalId: 'p_other' as PrincipalId },
        publicBoard
      ).allowed
    ).toBe(true)
  })

  it('sees its OWN pending (author escape hatch applies — service has a non-null principalId)', () => {
    expect(
      canViewPost(
        service,
        { moderationState: 'pending', principalId: service.principalId },
        publicBoard
      ).allowed
    ).toBe(true)
  })

  it("does NOT see another author's pending (value-equality, not blanket pending visibility)", () => {
    expect(
      canViewPost(
        service,
        { moderationState: 'pending', principalId: 'p_other' as PrincipalId },
        publicBoard
      ).allowed
    ).toBe(false)
  })

  it.each(['spam', 'archived', 'closed', 'deleted'] as ModerationState[])(
    'does NOT see its own %s (only pending qualifies for the hatch)',
    (state) => {
      expect(
        canViewPost(
          service,
          { moderationState: state, principalId: service.principalId },
          publicBoard
        ).allowed
      ).toBe(false)
    }
  )

  it('is denied on an authenticated-view board regardless of moderationState (board denies first)', () => {
    expect(
      canViewPost(
        service,
        { moderationState: 'published', principalId: service.principalId },
        authBoard
      ).allowed
    ).toBe(false)
  })
})

describe('canViewPost — ownership edges', () => {
  it("segment member does NOT see another author's pending on a segments board", () => {
    expect(
      canViewPost(
        trustedPortal,
        { moderationState: 'pending', principalId: 'p_other' as PrincipalId },
        segBoard
      ).allowed
    ).toBe(false)
  })

  it("team member sees another author's pending (team visibility is ownership-independent)", () => {
    expect(
      canViewPost(
        member,
        { moderationState: 'pending', principalId: 'p_other' as PrincipalId },
        teamBoard
      ).allowed
    ).toBe(true)
  })
})

describe('canVotePost — service principal + composition edges', () => {
  const publishedOther = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
  }
  const authVoteBoard = {
    access: {
      view: 'anonymous',
      vote: 'authenticated',
      comment: 'anonymous',
      submit: 'authenticated',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    } satisfies BoardAccess,
  }
  const segVoteBoard = (ids: string[]) => ({
    access: {
      view: 'anonymous',
      vote: 'segments',
      comment: 'anonymous',
      submit: 'anonymous',
      segments: { view: [], vote: ids, comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    } satisfies BoardAccess,
  })

  it('denies a service principal on board.vote=authenticated', () => {
    const d = canVotePost(service, publishedOther, authVoteBoard)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('Sign in to vote on this board')
  })

  it('allows a service principal on board.vote=anonymous', () => {
    expect(canVotePost(service, publishedOther, publicBoard)).toEqual({ allowed: true })
  })

  it('denies a service principal on board.vote=segments even with a matching segment id', () => {
    const d = canVotePost(
      { ...service, segmentIds: new Set(['segment_trusted' as SegmentId]) },
      publishedOther,
      segVoteBoard(['segment_trusted'])
    )
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('Only specific groups can vote on this board')
  })

  it('denies a non-team actor when board.vote=segments but the vote list is empty (fail closed)', () => {
    const d = canVotePost(trustedPortal, publishedOther, segVoteBoard([]))
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('Only specific groups can vote on this board')
  })

  it('allows the author to vote on their OWN pending post (own-pending view composes with vote tier)', () => {
    expect(
      canVotePost(
        portal,
        { moderationState: 'pending', principalId: portal.principalId },
        publicBoard
      )
    ).toEqual({ allowed: true })
  })

  it('denies anonymous voting on an anonymous-authored pending post (null !== null guard)', () => {
    const d = canVotePost(anon, { moderationState: 'pending', principalId: null }, publicBoard)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('Post is not yet visible')
  })

  it('denies a team actor from voting on a deleted post (view composition denies before vote tier)', () => {
    const d = canVotePost(
      admin,
      { moderationState: 'deleted', principalId: 'p_other' as PrincipalId },
      publicBoard
    )
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('Post was removed')
  })
})

describe('canCreateComment — service principal + precedence edges', () => {
  const published = {
    moderationState: 'published' as ModerationState,
    principalId: 'p_other' as PrincipalId,
    isCommentsLocked: false,
  }
  const commentTierBoard = (
    comment: BoardAccess['comment'],
    moderationComments: BoardAccess['moderation']['comments'] = 'inherit'
  ) => ({
    access: {
      view: 'anonymous',
      vote: 'anonymous',
      comment,
      submit: 'anonymous',
      segments: { view: [], vote: [], comment: [], submit: [] },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: moderationComments },
    } satisfies BoardAccess,
  })

  it('service can comment when the comment tier is anonymous', () => {
    expect(canCreateComment(service, published, publicBoard, 'none')).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })

  it('service is denied when the comment tier is authenticated', () => {
    const d = canCreateComment(service, published, commentTierBoard('authenticated'), 'none')
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toMatch(/sign in/i)
  })

  it("service comment is held when moderation.comments='on'", () => {
    expect(
      canCreateComment(service, published, commentTierBoard('anonymous', 'on'), 'none')
    ).toEqual({
      allowed: true,
      requiresApproval: true,
    })
  })

  it("lock beats approval: a non-team comment on a locked post is DENIED even when moderation.comments='on'", () => {
    const locked = { ...published, isCommentsLocked: true }
    const d = canCreateComment(portal, locked, commentTierBoard('anonymous', 'on'), 'none')
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toMatch(/locked/i)
  })

  it('comment tier-deny beats the lock reason (tier check precedes the lock check)', () => {
    const locked = { ...published, isCommentsLocked: true }
    const d = canCreateComment(portal, locked, commentTierBoard('team'), 'none')
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).not.toMatch(/locked/i)
      expect(d.reason).toMatch(/team members/i)
    }
  })

  it('view-deny reason wins over the comment-tier reason on a non-viewable board', () => {
    const d = canCreateComment(anon, published, authBoard, 'none')
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).not.toMatch(/comment/i)
  })

  it.each(['deleted', 'spam', 'archived', 'closed'] as ModerationState[])(
    "non-team cannot comment on another author's %s post (view gate)",
    (state) => {
      const d = canCreateComment(
        portal,
        { moderationState: state, principalId: 'p_other' as PrincipalId, isCommentsLocked: false },
        publicBoard,
        'none'
      )
      expect(d.allowed).toBe(false)
    }
  )

  it("author can comment on their OWN pending post and it is held when moderation.comments='on'", () => {
    const ownPending = {
      moderationState: 'pending' as ModerationState,
      principalId: portal.principalId,
      isCommentsLocked: false,
    }
    expect(
      canCreateComment(portal, ownPending, commentTierBoard('anonymous', 'on'), 'none')
    ).toEqual({
      allowed: true,
      requiresApproval: true,
    })
  })

  it("anonymous comment is held when moderation.comments='on'", () => {
    expect(canCreateComment(anon, published, commentTierBoard('anonymous', 'on'), 'none')).toEqual({
      allowed: true,
      requiresApproval: true,
    })
  })

  it('segment member can comment on their own pending post in a segments board', () => {
    const ownPending = {
      moderationState: 'pending' as ModerationState,
      principalId: trustedPortal.principalId,
      isCommentsLocked: false,
    }
    expect(canCreateComment(trustedPortal, ownPending, segBoard, 'none').allowed).toBe(true)
  })

  it("member (non-admin) comment is never held even with moderation.comments='on' and workspace='all'", () => {
    expect(canCreateComment(member, published, commentTierBoard('anonymous', 'on'), 'all')).toEqual(
      {
        allowed: true,
        requiresApproval: false,
      }
    )
  })

  it('portal comment with inherit + undefined workspace is not held', () => {
    expect(canCreateComment(portal, published, publicBoard, undefined)).toEqual({
      allowed: true,
      requiresApproval: false,
    })
  })
})

describe('canCreatePost — service principal + submit-tier edges', () => {
  const submitTierBoard = (
    submit: BoardAccess['submit'],
    segmentsSubmit: string[] = [],
    moderation: Partial<BoardAccess['moderation']> = {}
  ) => ({
    access: {
      view: 'anonymous',
      vote: 'anonymous',
      comment: 'anonymous',
      submit,
      segments: { view: [], vote: [], comment: [], submit: segmentsSubmit },
      moderation: {
        anonPosts: 'inherit',
        signedPosts: 'inherit',
        comments: 'inherit',
        ...moderation,
      },
    } satisfies BoardAccess,
  })

  it('denies a service principal on submit=authenticated', () => {
    expect(canCreatePost(service, submitTierBoard('authenticated'), 'none').allowed).toBe(false)
  })

  it('denies an anonymous actor on submit=segments', () => {
    expect(canCreatePost(anon, submitTierBoard('segments', ['segment_x']), 'none').allowed).toBe(
      false
    )
  })

  it("member can submit and bypass moderation on a fully-private board with rules 'on' + workspace='all'", () => {
    const board = {
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'on', signedPosts: 'on', comments: 'on' },
      } satisfies BoardAccess,
    }
    expect(canCreatePost(member, board, 'all')).toEqual({ allowed: true, requiresApproval: false })
  })

  it('submit deny reasons are the submit-specific hints', () => {
    const d1 = canCreatePost(anon, submitTierBoard('authenticated'), 'none')
    const d2 = canCreatePost(portal, submitTierBoard('segments', ['segment_x']), 'none')
    const d3 = canCreatePost(portal, submitTierBoard('team'), 'none')
    expect(d1.allowed).toBe(false)
    if (!d1.allowed) expect(d1.reason).toMatch(/sign in to submit/i)
    expect(d2.allowed).toBe(false)
    if (!d2.allowed) expect(d2.reason).toMatch(/specific groups/i)
    expect(d3.allowed).toBe(false)
    if (!d3.allowed) expect(d3.reason).toMatch(/team members/i)
  })

  it('service honors per-board anonPosts overrides (maps to the anonPosts axis — DESIGN PIN)', () => {
    const held = canCreatePost(
      service,
      submitTierBoard('anonymous', [], { anonPosts: 'on' }),
      'none'
    )
    expect(held).toEqual({ allowed: true, requiresApproval: true })
    const free = canCreatePost(
      service,
      submitTierBoard('anonymous', [], { anonPosts: 'off' }),
      'all'
    )
    expect(free).toEqual({ allowed: true, requiresApproval: false })
  })
})
