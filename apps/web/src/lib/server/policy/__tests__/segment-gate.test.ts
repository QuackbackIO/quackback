import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { segmentGateAllows, segmentGateFilter } from '../segment-gate'
import { statusComponents } from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '../types'

const dialect = new PgDialect()
function render(fragment: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(fragment)
}

function userActor(segmentIds: string[] = []): Actor {
  return {
    principalId: 'principal_01user' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(segmentIds as SegmentId[]),
  }
}

function serviceActor(segmentIds: string[] = []): Actor {
  return {
    principalId: 'principal_01svc' as PrincipalId,
    role: 'user',
    principalType: 'service',
    segmentIds: new Set(segmentIds as SegmentId[]),
  }
}

function teamActor(role: 'admin' | 'member'): Actor {
  return {
    principalId: 'principal_01team' as PrincipalId,
    role,
    principalType: 'user',
    segmentIds: new Set(),
  }
}

describe('segmentGateAllows', () => {
  it('an empty segment list means everyone, including anonymous', () => {
    expect(segmentGateAllows(ANONYMOUS_ACTOR, [])).toBe(true)
    expect(segmentGateAllows(userActor(), [])).toBe(true)
    expect(segmentGateAllows(serviceActor(), [])).toBe(true)
  })

  it('denies anonymous actors on any gated list (unresolvable viewer never sees restricted content)', () => {
    expect(segmentGateAllows(ANONYMOUS_ACTOR, ['seg_a'])).toBe(false)
  })

  it('allows a signed-in user sharing at least one segment', () => {
    expect(segmentGateAllows(userActor(['seg_a']), ['seg_a'])).toBe(true)
    expect(segmentGateAllows(userActor(['seg_b']), ['seg_a', 'seg_b'])).toBe(true)
  })

  it('denies a signed-in user with no overlapping segment', () => {
    expect(segmentGateAllows(userActor(['seg_other']), ['seg_a'])).toBe(false)
    expect(segmentGateAllows(userActor(), ['seg_a'])).toBe(false)
  })

  it('denies service principals even when their segment set overlaps', () => {
    expect(segmentGateAllows(serviceActor(['seg_a']), ['seg_a'])).toBe(false)
  })

  it('team actors (admin and member) bypass the gate entirely', () => {
    expect(segmentGateAllows(teamActor('admin'), ['seg_a'])).toBe(true)
    expect(segmentGateAllows(teamActor('member'), ['seg_a'])).toBe(true)
  })
})

describe('segmentGateFilter (structural)', () => {
  // Execution-level parity with segmentGateAllows is covered by the
  // help-center segment-gate integration test (real rows, real jsonb);
  // these pin the structural collapses that regressions would silently drop.

  it('collapses to a constant TRUE for team actors', () => {
    const { sql: text } = render(segmentGateFilter(teamActor('admin'), statusComponents.segmentIds))
    expect(text.trim()).toBe('true')
  })

  it('collapses the membership arm to FALSE for anonymous actors (no empty ANY())', () => {
    const { sql: text, params } = render(
      segmentGateFilter(ANONYMOUS_ACTOR, statusComponents.segmentIds)
    )
    expect(text).toContain('false')
    expect(text).not.toContain('ANY')
    expect(params).toEqual([])
  })

  it('collapses the membership arm to FALSE for service actors with segments', () => {
    const { sql: text } = render(
      segmentGateFilter(serviceActor(['seg_a']), statusComponents.segmentIds)
    )
    expect(text).toContain('false')
    expect(text).not.toContain('ANY')
  })

  it('builds the EXISTS/ANY membership arm for a user with segments, binding ids as params', () => {
    const { sql: text, params } = render(
      segmentGateFilter(userActor(['seg_a', 'seg_b']), statusComponents.segmentIds)
    )
    expect(text).toContain('EXISTS')
    expect(text).toContain('jsonb_array_elements_text')
    expect(text).toContain('ANY(ARRAY[')
    expect(params).toEqual(['seg_a', 'seg_b'])
  })
})
