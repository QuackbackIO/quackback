import { describe, it, expect } from 'vitest'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { canActorViewCategory } from '../help-center.visibility'

const ACTOR = {
  principalId: 'principal_123' as PrincipalId,
  segmentIds: new Set(['segment_vip' as SegmentId, 'segment_beta' as SegmentId]),
}

describe('canActorViewCategory', () => {
  it('allows public categories for anonymous actors', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: true,
        visibility: 'public',
        allowedPrincipalIds: [],
        allowedSegmentIds: [],
      },
      null
    )

    expect(allowed).toBe(true)
  })

  it('blocks disabled categories regardless of actor', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: false,
        visibility: 'public',
        allowedPrincipalIds: ['principal_123'],
        allowedSegmentIds: ['segment_vip'],
      },
      ACTOR
    )

    expect(allowed).toBe(false)
  })

  it('allows targeted category when principal is explicitly allowlisted', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: true,
        visibility: 'targeted',
        allowedPrincipalIds: ['principal_123'],
        allowedSegmentIds: [],
      },
      ACTOR
    )

    expect(allowed).toBe(true)
  })

  it('allows targeted category when actor matches any allowed segment', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: true,
        visibility: 'targeted',
        allowedPrincipalIds: [],
        allowedSegmentIds: ['segment_unknown', 'segment_vip'],
      },
      ACTOR
    )

    expect(allowed).toBe(true)
  })

  it('blocks targeted category when actor matches neither users nor segments', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: true,
        visibility: 'targeted',
        allowedPrincipalIds: ['principal_other'],
        allowedSegmentIds: ['segment_other'],
      },
      ACTOR
    )

    expect(allowed).toBe(false)
  })

  it('blocks targeted category for anonymous actors', () => {
    const allowed = canActorViewCategory(
      {
        isPublic: true,
        visibility: 'targeted',
        allowedPrincipalIds: ['principal_123'],
        allowedSegmentIds: ['segment_vip'],
      },
      null
    )

    expect(allowed).toBe(false)
  })
})
