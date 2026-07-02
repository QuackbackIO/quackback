/**
 * Differential-coverage tests for segment.service — list/get, create/update/
 * delete with validation + unique-slug probing + dynamic-rule rules, manual
 * assign/remove (type + validation guards, audit), and user→segment lookups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'groupBy', 'as'])
    chain[k] = () => chain
  chain.then = (r: (v: unknown) => void) => r(m.selectResult())
  const tx = {
    delete: () => ({ where: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }
  return {
    chain,
    tx,
    segmentsFindFirst: vi.fn(),
    selectResult: vi.fn(),
    insertReturning: vi.fn(),
    updateReturning: vi.fn(),
    deleteReturning: vi.fn(),
    removeSchedule: vi.fn((..._a: unknown[]) => Promise.resolve()),
    addMember: vi.fn((..._a: unknown[]) => Promise.resolve()),
    recordAudit: vi.fn(),
    dCreated: vi.fn(),
    dUpdated: vi.fn(),
    dDeleted: vi.fn(),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { segments: { findFirst: m.segmentsFindFirst } },
    select: () => m.chain,
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    delete: () => ({ where: () => ({ returning: m.deleteReturning }) }),
    transaction: async (cb: (t: typeof m.tx) => unknown) => cb(m.tx),
  },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true, as: () => ({ __sql: true }) }),
  segments: { id: 's.id', slug: 's.slug', name: 's.name', deletedAt: 's.deletedAt' },
  userSegments: { segmentId: 'us.segmentId', principalId: 'us.principalId' },
  principal: { id: 'pr.id' },
}))

vi.mock('@quackback/ids', () => ({ createId: () => 'segment_1' }))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...a: unknown[]) => m.recordAudit(...a),
}))
vi.mock('@/lib/shared/utils/string', () => ({
  slugify: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('@/lib/server/events/segment-scheduler', () => ({
  removeSegmentEvaluationSchedule: (...a: unknown[]) => m.removeSchedule(...a),
}))
vi.mock('../segment-membership.service', () => ({
  addMember: (...a: unknown[]) => m.addMember(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchSegmentCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchSegmentUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchSegmentDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import * as svc from '../segment.service'

const flush = () => new Promise((r) => setTimeout(r, 0))
const seg = (over: Record<string, unknown> = {}) => ({
  id: 'segment_1',
  name: 'VIPs',
  slug: 'vips',
  description: null,
  type: 'manual',
  color: '#6b7280',
  rules: null,
  evaluationSchedule: null,
  weightConfig: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.segmentsFindFirst.mockResolvedValue(undefined)
  m.selectResult.mockReturnValue([])
  m.insertReturning.mockResolvedValue([seg()])
  m.updateReturning.mockResolvedValue([seg()])
  m.deleteReturning.mockResolvedValue([])
})

describe('list / get', () => {
  it('listSegments maps member counts', async () => {
    m.selectResult.mockReturnValueOnce([{ ...seg(), memberCount: 4 }])
    const res = await svc.listSegments()
    expect(res[0].memberCount).toBe(4)
  })
  it('getSegment returns null / row', async () => {
    expect(await svc.getSegment('segment_1' as never)).toBeNull()
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    expect((await svc.getSegment('segment_1' as never))?.id).toBe('segment_1')
  })
})

describe('createSegment', () => {
  it('requires a name', async () => {
    await expect(svc.createSegment({ name: ' ', type: 'manual' } as never)).rejects.toThrow(
      'name is required'
    )
  })
  it('requires rules for a dynamic segment', async () => {
    await expect(svc.createSegment({ name: 'D', type: 'dynamic' } as never)).rejects.toThrow(
      'at least one rule'
    )
  })
  it('creates a manual segment, probing for a unique slug, and fires created', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce({ id: 'other' }) // slug collision -> -2
    m.segmentsFindFirst.mockResolvedValueOnce(undefined) // free
    await svc.createSegment({ name: ' VIPs ', type: 'manual', description: ' d ' } as never)
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('creates a dynamic segment with rules', async () => {
    await svc.createSegment({
      name: 'Power',
      type: 'dynamic',
      rules: { match: 'all', conditions: [{ attribute: 'plan', operator: 'eq', value: 'pro' }] },
    } as never)
    expect(m.insertReturning).toHaveBeenCalled()
  })
})

describe('updateSegment', () => {
  it('throws when missing', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.updateSegment('segment_1' as never, { name: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
  it('renames with a new slug and fires updated', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg({ slug: 'old' })) // getSegment
    m.segmentsFindFirst.mockResolvedValueOnce(undefined) // uniqueSegmentSlug -> free
    await svc.updateSegment(
      'segment_1' as never,
      {
        name: 'New Name',
        description: 'd',
        color: '#fff',
        rules: null,
        evaluationSchedule: null,
        weightConfig: null,
      } as never
    )
    await flush()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('keeps the slug when the name maps to the existing slug (excludeId match)', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg({ slug: 'vips' })) // getSegment
    m.segmentsFindFirst.mockResolvedValueOnce({ id: 'segment_1' }) // collision is itself
    await svc.updateSegment('segment_1' as never, { name: 'VIPs' } as never)
    expect(m.updateReturning).toHaveBeenCalled()
  })
  it('returns existing unchanged when no fields change', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    expect((await svc.updateSegment('segment_1' as never, {} as never)).id).toBe('segment_1')
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
})

describe('deleteSegment', () => {
  it('throws when missing', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.deleteSegment('segment_1' as never)).rejects.toThrow('not found')
  })
  it('removes schedule, soft-deletes in a transaction, and fires deleted', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    await svc.deleteSegment('segment_1' as never)
    await flush()
    expect(m.removeSchedule).toHaveBeenCalled()
    expect(m.dDeleted).toHaveBeenCalled()
  })
})

describe('assignUsersToSegment', () => {
  it('throws when missing / dynamic', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.assignUsersToSegment('segment_1' as never, ['p1'] as never)).rejects.toThrow(
      'not found'
    )
    m.segmentsFindFirst.mockResolvedValueOnce(seg({ type: 'dynamic' }))
    await expect(svc.assignUsersToSegment('segment_1' as never, ['p1'] as never)).rejects.toThrow(
      'dynamic segment'
    )
  })
  it('short-circuits on empty input and on all-invalid ids', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    expect(await svc.assignUsersToSegment('segment_1' as never, [] as never)).toEqual({
      assigned: 0,
    })
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    m.selectResult.mockReturnValueOnce([]) // no valid principals
    expect(await svc.assignUsersToSegment('segment_1' as never, ['ghost'] as never)).toEqual({
      assigned: 0,
    })
  })
  it('assigns validated principals via addMember', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    m.selectResult.mockReturnValueOnce([{ id: 'p1' }])
    const res = await svc.assignUsersToSegment(
      'segment_1' as never,
      ['p1'] as never,
      { principalId: 'admin' } as never
    )
    expect(res).toEqual({ assigned: 1 })
    expect(m.addMember).toHaveBeenCalled()
  })
})

describe('removeUsersFromSegment', () => {
  it('throws when missing / dynamic and short-circuits on empty', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.removeUsersFromSegment('segment_1' as never, ['p1'] as never)).rejects.toThrow(
      'not found'
    )
    m.segmentsFindFirst.mockResolvedValueOnce(seg({ type: 'dynamic' }))
    await expect(svc.removeUsersFromSegment('segment_1' as never, ['p1'] as never)).rejects.toThrow(
      'dynamic segment'
    )
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    expect(await svc.removeUsersFromSegment('segment_1' as never, [] as never)).toEqual({
      removed: 0,
    })
  })
  it('removes and writes audit rows when an actor is present', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    m.deleteReturning.mockResolvedValueOnce([{ principalId: 'p1' }])
    const res = await svc.removeUsersFromSegment(
      'segment_1' as never,
      ['p1'] as never,
      { principalId: 'admin' } as never
    )
    expect(res).toEqual({ removed: 1 })
    expect(m.recordAudit).toHaveBeenCalled()
  })
  it('removes without audit when no actor', async () => {
    m.segmentsFindFirst.mockResolvedValueOnce(seg())
    m.deleteReturning.mockResolvedValueOnce([{ principalId: 'p1' }])
    await svc.removeUsersFromSegment('segment_1' as never, ['p1'] as never)
    expect(m.recordAudit).not.toHaveBeenCalled()
  })
})

describe('lookups', () => {
  it('getUserSegments maps rows', async () => {
    m.selectResult.mockReturnValueOnce([
      { id: 'segment_1', name: 'VIPs', color: '#fff', type: 'manual' },
    ])
    expect(await svc.getUserSegments('p1' as never)).toEqual([
      { id: 'segment_1', name: 'VIPs', color: '#fff', type: 'manual' },
    ])
  })
  it('getPrincipalIdsInSegments returns null for empty, a Set otherwise', async () => {
    expect(await svc.getPrincipalIdsInSegments([])).toBeNull()
    m.selectResult.mockReturnValueOnce([{ principalId: 'p1' }, { principalId: 'p2' }])
    const set = await svc.getPrincipalIdsInSegments(['segment_1'] as never)
    expect(set).toEqual(new Set(['p1', 'p2']))
  })
})
