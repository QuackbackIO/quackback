/**
 * Exhaustive matrix for canViewRoadmap.
 *
 * The view-only mirror of boards.test.ts: every access.view tier × every
 * meaningful actor shape. A roadmap has a single `view` action, so this is the
 * full surface of its visibility logic.
 */
import { describe, it, expect } from 'vitest'
import { canViewRoadmap } from '../roadmaps'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import type { RoadmapAccess } from '@/lib/server/db'

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
// Access fixtures — one per meaningful (view tier, segments) shape
// ----------------------------------------------------------------------

const A: Record<string, RoadmapAccess> = {
  public: { view: 'anonymous', segments: { view: [] } },
  authenticated: { view: 'authenticated', segments: { view: [] } },
  team: { view: 'team', segments: { view: [] } },
  segmentAlpha: { view: 'segments', segments: { view: ['segment_alpha'] } },
  segmentBeta: { view: 'segments', segments: { view: ['segment_beta'] } },
  segmentAlphaBeta: { view: 'segments', segments: { view: ['segment_alpha', 'segment_beta'] } },
  segmentEmpty: { view: 'segments', segments: { view: [] } },
}

interface Row {
  name: string
  actor: Actor
  access: RoadmapAccess
  expected: boolean
  reason?: string
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
  { name: 'authenticated + member', actor: memberActor, access: A.authenticated, expected: true },
  { name: 'authenticated + admin', actor: adminActor, access: A.authenticated, expected: true },

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
    // The 'segments' tier requires principalType==='user' (tierAllows). A
    // service principal sharing a segment id is intentionally rejected.
    name: 'segments[alpha] + service in alpha (service is non-user, rejected)',
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

  // ---------- segments[] (empty list) — fail closed for non-team ----------
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

describe('canViewRoadmap — full access × actor matrix', () => {
  for (const row of matrix) {
    it(row.name, () => {
      const decision = canViewRoadmap(row.actor, { access: row.access })
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
