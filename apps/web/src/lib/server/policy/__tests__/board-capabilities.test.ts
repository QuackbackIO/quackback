import { describe, it, expect } from 'vitest'
import { boardCapabilitiesForActor, canCommentOnPost, type Actor } from '@/lib/server/policy'
import type { BoardAccess } from '@/lib/server/db'

// Per-board submit/vote/comment capability for the current viewer, composed
// with the workspace anonymous master switch — the single source of truth the
// portal + widget UIs use to decide whether to advertise the CTAs (Codex #191).

const ANON: Actor = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: new Set(),
}
const USER: Actor = {
  principalId: 'principal_user' as Actor['principalId'],
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const TEAM: Actor = {
  principalId: 'principal_team' as Actor['principalId'],
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

function makeAccess(overrides: Partial<BoardAccess> = {}): BoardAccess {
  return {
    view: 'anonymous',
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    ...overrides,
  }
}

describe('boardCapabilitiesForActor', () => {
  it('allows an anonymous viewer on an all-anonymous board when the workspace permits anon', () => {
    const caps = boardCapabilitiesForActor(ANON, makeAccess(), true)
    expect(caps).toEqual({ canSubmit: true, canVote: true, canComment: true })
  })

  it('denies an anonymous viewer when the workspace anonymous switch is off', () => {
    const caps = boardCapabilitiesForActor(ANON, makeAccess(), false)
    expect(caps).toEqual({ canSubmit: false, canVote: false, canComment: false })
  })

  it('denies an anonymous viewer when the board requires sign-in (default Public preset)', () => {
    // The Codex bug: vote/comment/submit are 'authenticated' but the workspace
    // switch is on — the viewer must still be denied by the per-board tier.
    const access = makeAccess({
      vote: 'authenticated',
      comment: 'authenticated',
      submit: 'authenticated',
    })
    const caps = boardCapabilitiesForActor(ANON, access, true)
    expect(caps).toEqual({ canSubmit: false, canVote: false, canComment: false })
  })

  it('allows an authenticated user on an authenticated-tier board (workspace switch irrelevant)', () => {
    const access = makeAccess({
      vote: 'authenticated',
      comment: 'authenticated',
      submit: 'authenticated',
    })
    // allowAnonymous=false must NOT affect a real user.
    const caps = boardCapabilitiesForActor(USER, access, false)
    expect(caps).toEqual({ canSubmit: true, canVote: true, canComment: true })
  })

  it('denies an authenticated user on a team-only board', () => {
    const access = makeAccess({ view: 'team', vote: 'team', comment: 'team', submit: 'team' })
    const caps = boardCapabilitiesForActor(USER, access, true)
    expect(caps).toEqual({ canSubmit: false, canVote: false, canComment: false })
  })

  it('lets a signed-in customer use a leftover board that has no moderation object', () => {
    const leftover = { view: 'anonymous', submit: 'authenticated' } as BoardAccess
    expect(boardCapabilitiesForActor(USER, leftover, true)).toEqual({
      canSubmit: true,
      canVote: true,
      canComment: true,
    })
    expect(boardCapabilitiesForActor(ANON, leftover, true)).toEqual({
      canSubmit: false,
      canVote: false,
      canComment: false,
    })
  })

  it('allows a team member everywhere regardless of the anonymous switch', () => {
    const access = makeAccess({ view: 'team', vote: 'team', comment: 'team', submit: 'team' })
    const caps = boardCapabilitiesForActor(TEAM, access, false)
    expect(caps).toEqual({ canSubmit: true, canVote: true, canComment: true })
  })

  it('ignores replyPolicy — an author-only board keeps the tier-based capability', () => {
    // replyPolicy is a per-post concern (a non-team user CAN reply on their
    // OWN post), so it must not change the board-level answer. canCommentOnPost
    // below is where it lands.
    const authorOnly = makeAccess({ replyPolicy: 'author-only' })
    expect(boardCapabilitiesForActor(USER, authorOnly, true)).toEqual(
      boardCapabilitiesForActor(USER, makeAccess(), true)
    )
    expect(boardCapabilitiesForActor(ANON, authorOnly, true)).toEqual({
      canSubmit: true,
      canVote: true,
      canComment: true,
    })
  })

  it('gates submit, vote and comment independently per tier', () => {
    // Vote open to anon, comment requires sign-in, submit requires sign-in.
    const access = makeAccess({
      vote: 'anonymous',
      comment: 'authenticated',
      submit: 'authenticated',
    })
    expect(boardCapabilitiesForActor(ANON, access, true)).toEqual({
      canSubmit: false,
      canVote: true,
      canComment: false,
    })
  })
})

// The per-POST capability: same composition as the board-level canComment
// (tier + workspace anonymous ceiling) plus the post's own author, which is
// what an author-only board decides on.

const OTHER_AUTHOR = 'principal_other' as Actor['principalId']

const publishedBy = (principalId: Actor['principalId']) => ({
  moderationState: 'published' as const,
  principalId,
})

describe('canCommentOnPost', () => {
  it('matches the board capability on a board with no reply policy', () => {
    expect(canCommentOnPost(USER, publishedBy(OTHER_AUTHOR), makeAccess(), true)).toBe(
      boardCapabilitiesForActor(USER, makeAccess(), true).canComment
    )
  })

  it('author-only: the post author may reply, another signed-in user may not', () => {
    const access = makeAccess({ replyPolicy: 'author-only' })
    expect(canCommentOnPost(USER, publishedBy(USER.principalId), access, true)).toBe(true)
    expect(canCommentOnPost(USER, publishedBy(OTHER_AUTHOR), access, true)).toBe(false)
  })

  it('author-only never blocks a team member', () => {
    const access = makeAccess({ replyPolicy: 'author-only' })
    expect(canCommentOnPost(TEAM, publishedBy(OTHER_AUTHOR), access, false)).toBe(true)
  })

  it('author-only denies an anonymous viewer even on an author-less post', () => {
    const access = makeAccess({ replyPolicy: 'author-only' })
    expect(canCommentOnPost(ANON, publishedBy(null), access, true)).toBe(false)
  })

  it('still applies the workspace anonymous ceiling to non-user actors', () => {
    expect(canCommentOnPost(ANON, publishedBy(null), makeAccess(), false)).toBe(false)
    expect(canCommentOnPost(ANON, publishedBy(null), makeAccess(), true)).toBe(true)
  })

  it('carries the real moderation state: the author may reply on their own pending post', () => {
    const ownPending = { moderationState: 'pending' as const, principalId: USER.principalId }
    expect(canCommentOnPost(USER, ownPending, makeAccess(), true)).toBe(true)
    const othersPending = { moderationState: 'pending' as const, principalId: OTHER_AUTHOR }
    expect(canCommentOnPost(USER, othersPending, makeAccess(), true)).toBe(false)
  })
})
