/**
 * Differential-coverage tests for segment.evaluation — drives the internal
 * buildConditionSql across every attribute/operator branch (via
 * evaluateDynamicSegment), plus the dynamic-sync add/remove/empty paths and the
 * all-segments + members helpers. `db`/`sql` are stubbed so the SQL builders run
 * without a database; only branch traversal matters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  selectWhere: vi.fn(),
  execute: vi.fn(),
  deleteReturning: vi.fn(),
  txInsertConflict: vi.fn(),
  txDeleteWhere: vi.fn(),
  getSegment: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@/lib/server/db', () => {
  const sqlTag: unknown = Object.assign((..._a: unknown[]) => ({ __sql: true }), {
    raw: (..._a: unknown[]) => ({ __raw: true }),
    join: (..._a: unknown[]) => ({ __join: true }),
  })
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing: m.txInsertConflict }) }),
    delete: () => ({ where: m.txDeleteWhere }),
  }
  return {
    db: {
      select: () => ({ from: () => ({ where: () => m.selectWhere() }) }),
      execute: (...a: unknown[]) => m.execute(...a),
      delete: () => ({ where: () => ({ returning: m.deleteReturning }) }),
      transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    },
    sql: sqlTag,
    eq: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    segments: { id: 's.id', type: 's.type', deletedAt: 's.deletedAt' },
    userSegments: {
      segmentId: 'us.segmentId',
      principalId: 'us.principalId',
      addedBy: 'us.addedBy',
    },
  }
})

vi.mock('@quackback/ids', () => ({ fromUuid: (_t: string, id: string) => id }))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('../segment.service', () => ({ getSegment: (...a: unknown[]) => m.getSegment(...a) }))
vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: (...a: unknown[]) => m.notify(...a),
}))

import {
  evaluateDynamicSegment,
  evaluateAllDynamicSegments,
  getSegmentMembers,
} from '../segment.evaluation'

const sid = 'segment_1' as never

const dynamic = (conditions: unknown[], match = 'all') => ({
  id: sid,
  name: 'Seg',
  type: 'dynamic',
  rules: { match, conditions },
})

beforeEach(() => {
  vi.clearAllMocks()
  m.selectWhere.mockResolvedValue([])
  m.execute.mockResolvedValue([])
  m.deleteReturning.mockResolvedValue([])
  m.txInsertConflict.mockResolvedValue(undefined)
  m.txDeleteWhere.mockResolvedValue(undefined)
})

const ATTRS = [
  'email',
  'email_verified',
  'plan',
  'metadata_key',
  'post_count',
  'vote_count',
  'comment_count',
  'name',
  'locale',
  'country',
  'last_active_days_ago',
  'signup_source',
  'principal_type',
  'contact_title',
  'contact_metadata_key',
  'organization_domain',
  'organization_external_id',
  'organization_metadata_key',
  'unknown_attr',
]

describe('buildConditionSql branch coverage (via evaluateDynamicSegment)', () => {
  it('covers is_set and is_not_set for every attribute', async () => {
    const conditions = [
      ...ATTRS.map((attribute) => ({ attribute, operator: 'is_set', metadataKey: 'k' })),
      ...ATTRS.map((attribute) => ({ attribute, operator: 'is_not_set', metadataKey: 'k' })),
      // metadata variants with no key -> null branch
      { attribute: 'metadata_key', operator: 'is_set' },
      { attribute: 'contact_metadata_key', operator: 'is_set' },
      { attribute: 'organization_metadata_key', operator: 'is_set' },
    ]
    m.getSegment.mockResolvedValueOnce(dynamic(conditions))
    const res = await evaluateDynamicSegment(sid)
    expect(res.segmentId).toBe(sid)
  })

  it("covers the 'in' operator for every attribute (and empty-array null)", async () => {
    const conditions = [
      { attribute: 'email', operator: 'in', value: [] }, // empty -> null
      ...ATTRS.map((attribute) => ({
        attribute,
        operator: 'in',
        value: ['a', 'b'],
        metadataKey: 'k',
      })),
      { attribute: 'metadata_key', operator: 'in', value: ['x'] },
      { attribute: 'contact_metadata_key', operator: 'in', value: ['x'] },
      { attribute: 'organization_metadata_key', operator: 'in', value: ['x'] },
    ]
    m.getSegment.mockResolvedValueOnce(dynamic(conditions, 'any'))
    await evaluateDynamicSegment(sid)
    expect(m.execute).toHaveBeenCalled()
  })

  it('covers comparator/string operators across attributes', async () => {
    const conditions = [
      { attribute: 'email_verified', operator: 'eq', value: true },
      { attribute: 'email', operator: 'contains', value: 'X@Y' },
      { attribute: 'email', operator: 'eq', value: 'A@B' },
      { attribute: 'email', operator: 'unsupported', value: 'a' }, // -> null
      { attribute: 'created_at_days_ago', operator: 'gt', value: 7 },
      { attribute: 'created_at_days_ago', operator: 'bad', value: 7 }, // -> null
      { attribute: 'plan', operator: 'starts_with', value: 'pro' },
      { attribute: 'plan', operator: 'eq', value: 'pro' },
      { attribute: 'metadata_key', operator: 'gt', value: 5, metadataKey: 'mrr' }, // numeric branch
      { attribute: 'metadata_key', operator: 'eq', value: 'v', metadataKey: 'k' },
      { attribute: 'metadata_key', operator: 'eq', value: 'v' }, // no key -> null
      { attribute: 'post_count', operator: 'gte', value: 1 },
      { attribute: 'post_count', operator: 'bad', value: 1 }, // -> null
      { attribute: 'vote_count', operator: 'lt', value: 3 },
      { attribute: 'comment_count', operator: 'lte', value: 2 },
      { attribute: 'name', operator: 'ends_with', value: 'son' },
      { attribute: 'name', operator: 'eq', value: 'Jo' },
      { attribute: 'locale', operator: 'neq', value: 'en' }, // null-safe neq
      { attribute: 'locale', operator: 'eq', value: 'en' },
      { attribute: 'country', operator: 'neq', value: 'us' }, // null-safe + upper
      { attribute: 'country', operator: 'eq', value: 'us' },
      { attribute: 'last_active_days_ago', operator: 'lt', value: 30 },
      { attribute: 'last_active_days_ago', operator: 'bad', value: 30 }, // -> null
      { attribute: 'signup_source', operator: 'eq', value: 'google' },
      { attribute: 'signup_source', operator: 'bad', value: 'g' }, // -> null
      { attribute: 'principal_type', operator: 'eq', value: 'user' },
      { attribute: 'principal_type', operator: 'bad', value: 'user' }, // -> null
      { attribute: 'contact_title', operator: 'eq', value: 'CEO' },
      { attribute: 'contact_title', operator: 'neq', value: 'CEO' }, // nullableNeq
      { attribute: 'contact_title', operator: 'bad', value: 'x' }, // textField null -> null
      { attribute: 'contact_metadata_key', operator: 'eq', value: 'v', metadataKey: 'k' },
      { attribute: 'contact_metadata_key', operator: 'eq', value: 'v' }, // no key
      { attribute: 'organization_domain', operator: 'eq', value: 'X.com' }, // lower
      { attribute: 'organization_external_id', operator: 'eq', value: 'ext' },
      { attribute: 'organization_metadata_key', operator: 'eq', value: 'v', metadataKey: 'k' },
      { attribute: 'organization_metadata_key', operator: 'eq', value: 'v' }, // no key
      { attribute: 'unknown_attr', operator: 'eq', value: 'x' }, // default -> null
    ]
    m.getSegment.mockResolvedValueOnce(dynamic(conditions))
    await evaluateDynamicSegment(sid)
    expect(m.execute).toHaveBeenCalled()
  })

  it('returns empty when all conditions are unsupported (no SQL produced)', async () => {
    m.getSegment.mockResolvedValueOnce(
      dynamic([{ attribute: 'unknown_attr', operator: 'eq', value: 'x' }])
    )
    const res = await evaluateDynamicSegment(sid)
    expect(res).toEqual({ segmentId: sid, added: 0, removed: 0 })
    expect(m.execute).not.toHaveBeenCalled()
  })
})

describe('evaluateDynamicSegment sync paths', () => {
  it('throws when the segment is missing', async () => {
    m.getSegment.mockResolvedValueOnce(null)
    await expect(evaluateDynamicSegment(sid)).rejects.toThrow('not found')
  })

  it('throws when the segment is not dynamic', async () => {
    m.getSegment.mockResolvedValueOnce({ id: sid, type: 'manual' })
    await expect(evaluateDynamicSegment(sid)).rejects.toThrow('not dynamic')
  })

  it('deletes dynamic rows and notifies when rules are empty', async () => {
    m.getSegment.mockResolvedValueOnce({
      id: sid,
      name: 'Seg',
      type: 'dynamic',
      rules: { conditions: [] },
    })
    m.deleteReturning.mockResolvedValueOnce([{ principalId: 'p1' }])
    const res = await evaluateDynamicSegment(sid)
    // notify is fire-and-forget via a dynamic import; entering this branch is
    // what matters for coverage, not the un-awaited side effect.
    expect(res.removed).toBe(1)
  })

  it('handles empty rules with nothing to delete (no notify)', async () => {
    m.getSegment.mockResolvedValueOnce({ id: sid, name: 'Seg', type: 'dynamic', rules: null })
    m.deleteReturning.mockResolvedValueOnce([])
    const res = await evaluateDynamicSegment(sid)
    expect(res.removed).toBe(0)
  })

  it('adds new matches and removes stale members within a transaction', async () => {
    m.getSegment.mockResolvedValueOnce(
      dynamic([{ attribute: 'name', operator: 'eq', value: 'Jo' }])
    )
    m.selectWhere.mockResolvedValueOnce([{ principalId: 'stale_1' }]) // current members
    m.execute.mockResolvedValueOnce([{ id: 'match_1' }]) // matching principals
    const res = await evaluateDynamicSegment(sid)
    expect(res).toEqual({ segmentId: sid, added: 1, removed: 1 })
    expect(m.txInsertConflict).toHaveBeenCalled()
    expect(m.txDeleteWhere).toHaveBeenCalled()
  })
})

describe('evaluateAllDynamicSegments + getSegmentMembers', () => {
  it('iterates every dynamic segment', async () => {
    m.selectWhere.mockResolvedValueOnce([{ id: sid }]) // dynamicSegments list
    m.getSegment.mockResolvedValueOnce({
      id: sid,
      name: 'Seg',
      type: 'dynamic',
      rules: { conditions: [] },
    })
    m.deleteReturning.mockResolvedValueOnce([])
    const results = await evaluateAllDynamicSegments()
    expect(results).toHaveLength(1)
  })

  it('lists segment members', async () => {
    m.selectWhere.mockResolvedValueOnce([{ principalId: 'p1' }, { principalId: 'p2' }])
    expect(await getSegmentMembers(sid)).toEqual(['p1', 'p2'])
  })
})
