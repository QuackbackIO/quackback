import { describe, it, expect } from 'vitest'
import { boardCapabilitiesForActor, type Actor } from '@/lib/server/policy'
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

  it('allows a team member everywhere regardless of the anonymous switch', () => {
    const access = makeAccess({ view: 'team', vote: 'team', comment: 'team', submit: 'team' })
    const caps = boardCapabilitiesForActor(TEAM, access, false)
    expect(caps).toEqual({ canSubmit: true, canVote: true, canComment: true })
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
