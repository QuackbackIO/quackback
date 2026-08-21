/**
 * Segment evaluation scheduling.
 *
 * The schedules are derived from `segments` rows on every tick rather than
 * registered anywhere, so what these tests pin is the derivation: which rows
 * become schedules, what happens to a row whose cron cannot be parsed, and that
 * a disabled or deleted segment simply stops appearing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SegmentId } from '@quackback/ids'

interface SegmentRow {
  id: string
  evaluationSchedule: { enabled: boolean; pattern: string } | null
}

let rows: SegmentRow[] = []
let tableReads = 0

vi.mock('@/lib/server/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    // The scheduler filters `type = 'dynamic' AND deleted_at IS NULL` in SQL;
    // the fixture stands in for the rows that survive it.
    where: async () => {
      tableReads += 1
      return rows
    },
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
  __clearSegmentScheduleMemoForTests,
  listEvaluationSchedules,
  removeSegmentEvaluationSchedule,
  segmentEvaluationSchedules,
  upsertSegmentEvaluationSchedule,
} from '../segment-scheduler'

beforeEach(() => {
  rows = []
  tableReads = 0
  __clearSegmentScheduleMemoForTests()
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

describe('schedule memo', () => {
  it('does not re-read the table within the TTL', async () => {
    rows = [{ id: 'segment_a', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    const first = await segmentEvaluationSchedules()

    // The table changes underneath, with no invalidation hook fired: within
    // the TTL the memo answers, so the read count is what proves the memo is
    // real — a memo that silently re-read every time would still return equal
    // lists here.
    rows = [{ id: 'segment_b', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    const second = await segmentEvaluationSchedules()

    expect(tableReads).toBe(1)
    expect(second).toEqual(first)
  })

  it('re-reads after the upsert hook invalidates', async () => {
    rows = [{ id: 'segment_a', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    await segmentEvaluationSchedules()

    rows = [{ id: 'segment_b', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    await upsertSegmentEvaluationSchedule('segment_b' as SegmentId, {
      enabled: true,
      pattern: '0 * * * *',
    })

    const after = await segmentEvaluationSchedules()
    expect(tableReads).toBe(2)
    expect(after.map((s) => s.key)).toEqual(['segment_b'])
  })

  it('re-reads after the remove hook invalidates', async () => {
    rows = [{ id: 'segment_a', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    await segmentEvaluationSchedules()

    rows = []
    await removeSegmentEvaluationSchedule('segment_a' as SegmentId)

    expect(await segmentEvaluationSchedules()).toEqual([])
    expect(tableReads).toBe(2)
  })

  it('re-reads once the TTL lapses', async () => {
    vi.useFakeTimers()
    rows = [{ id: 'segment_a', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    await segmentEvaluationSchedules()

    rows = [{ id: 'segment_b', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } }]
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)

    const after = await segmentEvaluationSchedules()
    expect(tableReads).toBe(2)
    expect(after.map((s) => s.key)).toEqual(['segment_b'])
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
