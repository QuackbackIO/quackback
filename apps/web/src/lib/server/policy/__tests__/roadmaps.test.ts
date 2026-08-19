import { describe, expect, it } from 'vitest'
import { createId, type PrincipalId, type SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { canViewRoadmap } from '../roadmaps'

const segmentA = createId('segment') as SegmentId

function actor(overrides: Partial<Actor>): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    ...overrides,
  }
}

describe('canViewRoadmap', () => {
  it('allows only public roadmaps to anonymous viewers', () => {
    expect(
      canViewRoadmap(ANONYMOUS_ACTOR, { visibility: 'public', visibleSegmentIds: null }).allowed
    ).toBe(true)
    expect(
      canViewRoadmap(ANONYMOUS_ACTOR, { visibility: 'team', visibleSegmentIds: null }).allowed
    ).toBe(false)
    expect(
      canViewRoadmap(ANONYMOUS_ACTOR, {
        visibility: 'segment',
        visibleSegmentIds: [segmentA],
      }).allowed
    ).toBe(false)
  })

  it('allows matching portal users and denies non-matching or service principals', () => {
    const roadmap = { visibility: 'segment' as const, visibleSegmentIds: [segmentA] }
    expect(canViewRoadmap(actor({ segmentIds: new Set([segmentA]) }), roadmap).allowed).toBe(true)
    expect(canViewRoadmap(actor({}), roadmap).allowed).toBe(false)
    expect(
      canViewRoadmap(actor({ principalType: 'service', segmentIds: new Set([segmentA]) }), roadmap)
        .allowed
    ).toBe(false)
  })

  it('allows team actors to see every non-deleted roadmap', () => {
    const team = actor({ role: 'member' })
    expect(canViewRoadmap(team, { visibility: 'team', visibleSegmentIds: null }).allowed).toBe(true)
    expect(
      canViewRoadmap(team, {
        visibility: 'segment',
        visibleSegmentIds: [],
        deletedAt: new Date(),
      }).allowed
    ).toBe(false)
  })
})
