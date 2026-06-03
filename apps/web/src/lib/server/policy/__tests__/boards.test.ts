/**
 * Exhaustive matrix for canViewBoard.
 *
 * Every access.view tier × every meaningful actor shape. The goal is to make
 * any future regression in board-visibility logic detectable from a single
 * test failure with an unambiguous diagnostic message.
 *
 * Reads alongside `invariants.test.ts` which property-checks
 * determinism and the team-bypass invariant.
 */
import { describe, it, expect } from 'vitest'
import { canViewBoard } from '../boards'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import type { BoardAccess } from '@/lib/server/db'

// ----------------------------------------------------------------------
// Actor fixtures — one per meaningful shape
// ----------------------------------------------------------------------

const adminActor: Actor = {
  principalId: 'principal_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const memberActor: Actor = {
  principalId: 'principal_member' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

const portalUserNoSegments: Actor = {
  principalId: 'principal_user' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const portalUserInAlpha: Actor = {
  principalId: 'principal_alpha' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}

const portalUserInAlphaBeta: Actor = {
  principalId: 'principal_alphabeta' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha', 'segment_beta'] as SegmentId[]),
}

const servicePrincipal: Actor = {
  principalId: 'principal_svc' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(),
}

const serviceInAlpha: Actor = {
  principalId: 'principal_svc_seg' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}

// ----------------------------------------------------------------------
// Access fixtures — one per meaningful (view tier, segments) shape.
// For these fixtures the same allowlist is mirrored across all three
// actions, matching the historical single-list semantics so the matrix
// below keeps its meaning post-migration.
// ----------------------------------------------------------------------

const sharedSegments = (ids: string[]) => ({
  view: ids,
  vote: ids,
  comment: ids,
  submit: ids,
})

const A: Record<string, BoardAccess> = {
  public: {
    view: 'anonymous',
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segments: sharedSegments([]),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  authenticated: {
    view: 'authenticated',
    vote: 'authenticated',
    comment: 'authenticated',
    submit: 'authenticated',
    segments: sharedSegments([]),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  team: {
    view: 'team',
    vote: 'team',
    comment: 'team',
    submit: 'team',
    segments: sharedSegments([]),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  segmentAlpha: {
    view: 'segments',
    vote: 'segments',
    comment: 'segments',
    submit: 'segments',
    segments: sharedSegments(['segment_alpha']),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  segmentBeta: {
    view: 'segments',
    vote: 'segments',
    comment: 'segments',
    submit: 'segments',
    segments: sharedSegments(['segment_beta']),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  segmentAlphaBeta: {
    view: 'segments',
    vote: 'segments',
    comment: 'segments',
    submit: 'segments',
    segments: sharedSegments(['segment_alpha', 'segment_beta']),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  segmentEmpty: {
    view: 'segments',
    vote: 'segments',
    comment: 'segments',
    submit: 'segments',
    segments: sharedSegments([]),
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
}

// ----------------------------------------------------------------------
// Matrix expressed as a table
// ----------------------------------------------------------------------

interface Row {
  name: string
  actor: Actor
  access: BoardAccess
  expected: boolean
  reason?: string // substring expected in deny reason
}

const matrix: Row[] = [
  // ---------- public ----------
  { name: 'public + anonymous', actor: ANONYMOUS_ACTOR, access: A.public, expected: true },
  { name: 'public + portal user', actor: portalUserNoSegments, access: A.public, expected: true },
  { name: 'public + service', actor: servicePrincipal, access: A.public, expected: true },
  { name: 'public + member', actor: memberActor, access: A.public, expected: true },
  { name: 'public + admin', actor: adminActor, access: A.public, expected: true },

  // ---------- authenticated ----------
  {
    name: 'authenticated + anonymous',
    actor: ANONYMOUS_ACTOR,
    access: A.authenticated,
    expected: false,
    reason: 'Sign in',
  },
  {
    name: 'authenticated + portal user',
    actor: portalUserNoSegments,
    access: A.authenticated,
    expected: true,
  },
  {
    name: 'authenticated + service principal (NOT a user)',
    actor: servicePrincipal,
    access: A.authenticated,
    expected: false,
    reason: 'Sign in',
  },
  {
    name: 'authenticated + member always passes',
    actor: memberActor,
    access: A.authenticated,
    expected: true,
  },
  {
    name: 'authenticated + admin always passes',
    actor: adminActor,
    access: A.authenticated,
    expected: true,
  },

  // ---------- team ----------
  {
    name: 'team + anonymous',
    actor: ANONYMOUS_ACTOR,
    access: A.team,
    expected: false,
    reason: 'internal',
  },
  {
    name: 'team + portal user',
    actor: portalUserNoSegments,
    access: A.team,
    expected: false,
    reason: 'internal',
  },
  {
    name: 'team + segment-member portal user (still excluded)',
    actor: portalUserInAlpha,
    access: A.team,
    expected: false,
    reason: 'internal',
  },
  {
    name: 'team + service (non-team service is excluded)',
    actor: servicePrincipal,
    access: A.team,
    expected: false,
    reason: 'internal',
  },
  { name: 'team + member', actor: memberActor, access: A.team, expected: true },
  { name: 'team + admin', actor: adminActor, access: A.team, expected: true },

  // ---------- segments[alpha] ----------
  {
    name: 'segments[alpha] + anonymous',
    actor: ANONYMOUS_ACTOR,
    access: A.segmentAlpha,
    expected: false,
    reason: 'restricted',
  },
  {
    name: 'segments[alpha] + portal user not in segment',
    actor: portalUserNoSegments,
    access: A.segmentAlpha,
    expected: false,
    reason: 'restricted',
  },
  {
    name: 'segments[alpha] + portal user in alpha',
    actor: portalUserInAlpha,
    access: A.segmentAlpha,
    expected: true,
  },
  {
    name: 'segments[alpha] + portal user in alpha+beta (any-match)',
    actor: portalUserInAlphaBeta,
    access: A.segmentAlpha,
    expected: true,
  },
  {
    // Tier-model behaviour: the 'segments' tier requires principalType==='user'
    // (see tierAllows). A service principal that happens to share a segment id
    // is intentionally rejected — service callers should be treated as a
    // separate, non-portal class. Pinned by access.test.ts "rejects service
    // even if in segment".
    name: 'segments[alpha] + service in alpha (service is non-user, rejected by tier)',
    actor: serviceInAlpha,
    access: A.segmentAlpha,
    expected: false,
    reason: 'restricted',
  },
  {
    name: 'segments[alpha] + member (team always)',
    actor: memberActor,
    access: A.segmentAlpha,
    expected: true,
  },
  {
    name: 'segments[alpha] + admin (team always)',
    actor: adminActor,
    access: A.segmentAlpha,
    expected: true,
  },

  // ---------- segments[beta] — confirm no false-positive ----------
  {
    name: 'segments[beta] + portal user in alpha (wrong segment)',
    actor: portalUserInAlpha,
    access: A.segmentBeta,
    expected: false,
    reason: 'restricted',
  },

  // ---------- segments[alpha, beta] — multi-allowed ----------
  {
    name: 'segments[alpha,beta] + portal user in alpha only',
    actor: portalUserInAlpha,
    access: A.segmentAlphaBeta,
    expected: true,
  },
  {
    name: 'segments[alpha,beta] + portal user not in either',
    actor: portalUserNoSegments,
    access: A.segmentAlphaBeta,
    expected: false,
    reason: 'restricted',
  },

  // ---------- segments[] (empty list) — non-team should be denied ----------
  {
    name: 'segments[] empty + anonymous',
    actor: ANONYMOUS_ACTOR,
    access: A.segmentEmpty,
    expected: false,
    reason: 'restricted',
  },
  {
    name: 'segments[] empty + portal user in alpha (no listed segment matches)',
    actor: portalUserInAlpha,
    access: A.segmentEmpty,
    expected: false,
    reason: 'restricted',
  },
  {
    name: 'segments[] empty + admin (team always)',
    actor: adminActor,
    access: A.segmentEmpty,
    expected: true,
  },
]

describe('canViewBoard — full access × actor matrix', () => {
  for (const row of matrix) {
    it(row.name, () => {
      const decision = canViewBoard(row.actor, { access: row.access })
      if (row.expected) {
        expect(decision).toEqual({ allowed: true })
      } else {
        expect(decision.allowed).toBe(false)
        if (!decision.allowed && row.reason) {
          expect(decision.reason.toLowerCase()).toContain(row.reason.toLowerCase())
        }
      }
    })
  }
})

describe('canViewBoard — idempotence + freshness', () => {
  it('returns a fresh decision object each call (no shared state)', () => {
    const a = canViewBoard(ANONYMOUS_ACTOR, { access: A.public })
    const b = canViewBoard(ANONYMOUS_ACTOR, { access: A.public })
    expect(a).not.toBe(b) // different references
    expect(a).toEqual(b) // structurally equal
  })

  it('a board with extra fields beyond access still works (structural typing)', () => {
    // canViewBoard's input type is `{ access: BoardAccess }`. By
    // structural typing, a richer board record (with settings, timestamps,
    // …) is accepted without casts. This guards against any future refactor
    // that tightens the input shape and breaks list-query callers that pass
    // the full row.
    interface FatBoard {
      access: BoardAccess
      settings: Record<string, unknown>
      label: string
    }
    const board: FatBoard = {
      access: A.public,
      settings: {},
      label: 'noise',
    }
    expect(canViewBoard(portalUserInAlpha, board)).toEqual({ allowed: true })
  })
})
