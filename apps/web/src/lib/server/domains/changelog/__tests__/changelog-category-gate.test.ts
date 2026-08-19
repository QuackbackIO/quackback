import { describe, it, expect } from 'vitest'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { categoryGateAllows } from '../changelog-category.service'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

function userActor(segmentIds: string[]): Actor {
  return {
    principalId: 'principal_01user' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(segmentIds as SegmentId[]),
  }
}

function teamActor(): Actor {
  return {
    principalId: 'principal_01team' as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

describe('categoryGateAllows', () => {
  it('allows when the entry has no categories', () => {
    expect(categoryGateAllows([], ANONYMOUS_ACTOR)).toBe(true)
  })

  it('allows when every category is ungated (empty segmentIds = everyone)', () => {
    const categories = [{ segmentIds: [] }, { segmentIds: [] }]
    expect(categoryGateAllows(categories, ANONYMOUS_ACTOR)).toBe(true)
  })

  it('denies an anonymous actor when any category is segment-gated', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, ANONYMOUS_ACTOR)).toBe(false)
  })

  it('denies a signed-in user who is not a member of the gating segment', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, userActor(['seg_other']))).toBe(false)
  })

  it('allows a signed-in user who is a member of the gating segment', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, userActor(['seg_enterprise']))).toBe(true)
  })

  it('requires ALL gated categories to pass (AND semantics)', () => {
    const categories = [{ segmentIds: ['seg_a'] }, { segmentIds: ['seg_b'] }]
    // Member of seg_a only — still denied because seg_b also gates.
    expect(categoryGateAllows(categories, userActor(['seg_a']))).toBe(false)
    expect(categoryGateAllows(categories, userActor(['seg_a', 'seg_b']))).toBe(true)
  })

  it('a mix of gated and ungated categories only enforces the gated one', () => {
    const categories = [{ segmentIds: [] }, { segmentIds: ['seg_a'] }]
    expect(categoryGateAllows(categories, userActor(['seg_a']))).toBe(true)
    expect(categoryGateAllows(categories, userActor([]))).toBe(false)
  })

  it('team actors bypass the gate entirely', () => {
    const categories = [{ segmentIds: ['seg_enterprise'] }]
    expect(categoryGateAllows(categories, teamActor())).toBe(true)
  })
})
