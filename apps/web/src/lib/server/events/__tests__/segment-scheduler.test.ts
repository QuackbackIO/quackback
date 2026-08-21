/**
 * Segment evaluation scheduling.
 *
 * The schedules are derived from `segments` rows on every tick rather than
 * registered anywhere, so what these tests pin is the derivation: which rows
 * become schedules, what happens to a row whose cron cannot be parsed, and that
 * a disabled or deleted segment simply stops appearing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SegmentRow {
  id: string
  evaluationSchedule: { enabled: boolean; pattern: string } | null
}

let rows: SegmentRow[] = []

vi.mock('@/lib/server/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    // The scheduler filters `type = 'dynamic' AND deleted_at IS NULL` in SQL;
    // the fixture stands in for the rows that survive it.
    where: async () => rows,
  }
  return {
    db: chain,
    segments: {
      id: 'id',
      evaluationSchedule: 'evaluationSchedule',
      type: 'type',
      deletedAt: 'deletedAt',
    },
    eq: () => true,
    and: () => true,
    isNull: () => true,
  }
})

import {
  listEvaluationSchedules,
  segmentEvaluationSchedules,
} from '../segment-scheduler'

beforeEach(() => {
  rows = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('segmentEvaluationSchedules', () => {
  it('derives one schedule per enabled dynamic segment', async () => {
    rows = [
      { id: 'segment_a', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } },
      { id: 'segment_b', evaluationSchedule: { enabled: true, pattern: '*/5 * * * *' } },
    ]
    const schedules = await segmentEvaluationSchedules()
    expect(schedules).toEqual([
      { key: 'segment_a', cron: '0 * * * *', payload: { segmentId: 'segment_a' } },
      { key: 'segment_b', cron: '*/5 * * * *', payload: { segmentId: 'segment_b' } },
    ])
  })

  it('omits a segment whose schedule is disabled or absent', async () => {
    rows = [
      { id: 'segment_off', evaluationSchedule: { enabled: false, pattern: '0 * * * *' } },
      { id: 'segment_none', evaluationSchedule: null },
    ]
    expect(await segmentEvaluationSchedules()).toEqual([])
  })

  it('drops a segment whose cron cannot be parsed rather than guessing a cadence', async () => {
    // A permissive fallback would change the segment's cadence with no error
    // anywhere, which is the failure mode `cron.ts` throws to prevent.
    rows = [
      { id: 'segment_bad', evaluationSchedule: { enabled: true, pattern: 'every 5 minutes' } },
      { id: 'segment_ok', evaluationSchedule: { enabled: true, pattern: '0 3 * * *' } },
    ]
    const schedules = await segmentEvaluationSchedules()
    expect(schedules.map((s) => s.key)).toEqual(['segment_ok'])
  })
})

describe('listEvaluationSchedules', () => {
  it('reports the live schedules with their next fire time', async () => {
    rows = [{ id: 'segment_one', evaluationSchedule: { enabled: true, pattern: '*/5 * * * *' } }]
    const listed = await listEvaluationSchedules()
    expect(listed).toHaveLength(1)
    expect(listed[0].segmentId).toBe('segment_one')
    expect(listed[0].pattern).toBe('*/5 * * * *')
    expect(listed[0].next).toBeGreaterThan(Date.now())
  })

  it('lists nothing when no segment carries a schedule', async () => {
    rows = [{ id: 'segment_two', evaluationSchedule: null }]
    expect(await listEvaluationSchedules()).toEqual([])
  })
})
