import { describe, it, expect } from 'vitest'
import { tierAllows } from '../access'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'

const anon = ANONYMOUS_ACTOR
const portal: Actor = {
  principalId: 'p_portal' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const portalInAlpha: Actor = {
  principalId: 'p_alpha' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}
const service: Actor = {
  principalId: 'p_svc' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(),
}
const member: Actor = {
  principalId: 'p_mem' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}
const admin: Actor = {
  principalId: 'p_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

describe('tierAllows — anonymous tier', () => {
  it.each([
    ['anon', anon],
    ['portal', portal],
    ['service', service],
    ['member', member],
    ['admin', admin],
  ] as const)('admits %s', (_, actor) => {
    expect(tierAllows(actor, 'anonymous', [])).toBe(true)
  })
})

describe('tierAllows — authenticated tier', () => {
  it('rejects anon', () => {
    expect(tierAllows(anon, 'authenticated', [])).toBe(false)
  })
  it('admits portal user', () => {
    expect(tierAllows(portal, 'authenticated', [])).toBe(true)
  })
  it('rejects service principalType', () => {
    expect(tierAllows(service, 'authenticated', [])).toBe(false)
  })
  it('admits team (member)', () => {
    expect(tierAllows(member, 'authenticated', [])).toBe(true)
  })
  it('admits team (admin)', () => {
    expect(tierAllows(admin, 'authenticated', [])).toBe(true)
  })
})

describe('tierAllows — segments tier', () => {
  const alpha = ['segment_alpha']
  it('rejects anon', () => {
    expect(tierAllows(anon, 'segments', alpha)).toBe(false)
  })
  it('rejects portal user not in segment', () => {
    expect(tierAllows(portal, 'segments', alpha)).toBe(false)
  })
  it('admits portal user in segment', () => {
    expect(tierAllows(portalInAlpha, 'segments', alpha)).toBe(true)
  })
  it('rejects service even if in segment', () => {
    const svcInAlpha: Actor = {
      ...service,
      segmentIds: new Set(['segment_alpha' as SegmentId]),
    }
    expect(tierAllows(svcInAlpha, 'segments', alpha)).toBe(false)
  })
  it('admits team regardless of segment membership', () => {
    expect(tierAllows(member, 'segments', alpha)).toBe(true)
    expect(tierAllows(admin, 'segments', alpha)).toBe(true)
  })
  it('rejects non-team when segment list is empty (fail-closed)', () => {
    expect(tierAllows(portalInAlpha, 'segments', [])).toBe(false)
  })
})

describe('tierAllows — team tier', () => {
  it('rejects everyone non-team', () => {
    expect(tierAllows(anon, 'team', [])).toBe(false)
    expect(tierAllows(portal, 'team', [])).toBe(false)
    expect(tierAllows(portalInAlpha, 'team', [])).toBe(false)
    expect(tierAllows(service, 'team', [])).toBe(false)
  })
  it('admits team', () => {
    expect(tierAllows(member, 'team', [])).toBe(true)
    expect(tierAllows(admin, 'team', [])).toBe(true)
  })
  it('admits team even when a non-empty segment list is supplied', () => {
    // The isTeamActor early-return must win regardless of the segment-list arg.
    expect(tierAllows(admin, 'team', ['segment_alpha'])).toBe(true)
    expect(tierAllows(member, 'team', ['segment_alpha'])).toBe(true)
  })
})

// ----------------------------------------------------------------------
// Audit gap-fill — matrix cells the canonical happy/deny tests leave
// unpinned. Each guards a distinct fail-open refactor risk.
// ----------------------------------------------------------------------

describe('tierAllows — additional matrix cells', () => {
  it('rejects a portal user who is in a DIFFERENT non-empty segment than the board list', () => {
    // Existing "rejects portal user not in segment" uses an EMPTY actor set;
    // this pins the non-empty-mismatch path so an intersection refactor can't
    // fail open.
    expect(
      tierAllows({ ...portal, segmentIds: new Set(['segment_beta' as SegmentId]) }, 'segments', [
        'segment_alpha',
      ])
    ).toBe(false)
  })

  it('admits a portal user who matches one of several board segments (partial overlap)', () => {
    expect(tierAllows(portalInAlpha, 'segments', ['segment_other', 'segment_alpha'])).toBe(true)
  })

  it('rejects anon when the board segment list is also empty (double fail-closed)', () => {
    expect(tierAllows(anon, 'segments', [])).toBe(false)
  })

  it('rejects service on the authenticated tier even when it carries segmentIds', () => {
    // The authenticated principalType guard is independent of segment membership.
    expect(
      tierAllows(
        { ...service, segmentIds: new Set(['segment_alpha' as SegmentId]) },
        'authenticated',
        []
      )
    ).toBe(false)
  })

  it('admits a segmented portal user on the lower authenticated tier', () => {
    expect(tierAllows(portalInAlpha, 'authenticated', [])).toBe(true)
  })

  it('admits a segmented portal user on the anonymous tier', () => {
    expect(tierAllows(portalInAlpha, 'anonymous', [])).toBe(true)
  })
})
