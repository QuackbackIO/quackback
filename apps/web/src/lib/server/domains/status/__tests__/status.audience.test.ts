import { describe, it, expect } from 'vitest'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { isStatusAudienceGranted } from '../status.audience'
import { canViewStatusComponent } from '@/lib/server/policy/status'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import type { StatusSettings } from '@/lib/shared/status-settings'

function userActor(segmentIds: string[] = []): Actor {
  return {
    principalId: 'principal_01user' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(segmentIds as SegmentId[]),
    permissions: new Set(),
  }
}

function teamActor(): Actor {
  return {
    principalId: 'principal_01team' as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(),
  }
}

function settings(
  over: Partial<StatusSettings>
): Pick<StatusSettings, 'audience' | 'allowedSegmentIds'> {
  return { audience: 'public', allowedSegmentIds: [], ...over }
}

describe('isStatusAudienceGranted (Layer 1 page gate)', () => {
  it('public: everyone including anonymous is granted', () => {
    expect(isStatusAudienceGranted(ANONYMOUS_ACTOR, settings({ audience: 'public' }))).toBe(true)
    expect(isStatusAudienceGranted(userActor(), settings({ audience: 'public' }))).toBe(true)
  })

  it('authenticated: anonymous denied, signed-in user granted', () => {
    expect(isStatusAudienceGranted(ANONYMOUS_ACTOR, settings({ audience: 'authenticated' }))).toBe(
      false
    )
    expect(isStatusAudienceGranted(userActor(), settings({ audience: 'authenticated' }))).toBe(true)
  })

  it('segments: only a user sharing an allowed segment is granted', () => {
    const s = settings({ audience: 'segments', allowedSegmentIds: ['segment_ent'] })
    expect(isStatusAudienceGranted(ANONYMOUS_ACTOR, s)).toBe(false)
    expect(isStatusAudienceGranted(userActor([]), s)).toBe(false)
    expect(isStatusAudienceGranted(userActor(['segment_other']), s)).toBe(false)
    expect(isStatusAudienceGranted(userActor(['segment_ent']), s)).toBe(true)
  })

  it('team always passes, even a segments-gated page they are not a member of', () => {
    const s = settings({ audience: 'segments', allowedSegmentIds: ['segment_ent'] })
    expect(isStatusAudienceGranted(teamActor(), s)).toBe(true)
  })
})

describe('canViewStatusComponent (Layer 2 per-component narrowing)', () => {
  it('an ungated component ([] segments) is visible to everyone who passed Layer 1', () => {
    expect(canViewStatusComponent(ANONYMOUS_ACTOR, { segmentIds: [] })).toBe(true)
    expect(canViewStatusComponent(userActor(), { segmentIds: [] })).toBe(true)
  })

  it('a gated component is visible only to a user sharing one of its segments', () => {
    expect(canViewStatusComponent(userActor([]), { segmentIds: ['segment_ent'] })).toBe(false)
    expect(
      canViewStatusComponent(userActor(['segment_ent']), { segmentIds: ['segment_ent'] })
    ).toBe(true)
    expect(canViewStatusComponent(ANONYMOUS_ACTOR, { segmentIds: ['segment_ent'] })).toBe(false)
  })

  it('team bypasses component gating', () => {
    expect(canViewStatusComponent(teamActor(), { segmentIds: ['segment_ent'] })).toBe(true)
  })
})
