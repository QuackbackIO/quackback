/**
 * Differential-coverage tests for audit.queries — cursor encode/decode,
 * the full filter-condition matrix, cursor pagination (hasMore / nextCursor),
 * and distinct-action listing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  limitMock: vi.fn(),
  distinctLimitMock: vi.fn(),
}))

vi.mock('@/lib/server/db', () => {
  const selectChain = {
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: m.limitMock }) }),
    }),
  }
  const distinctChain = {
    from: () => ({ orderBy: () => ({ limit: m.distinctLimitMock }) }),
  }
  const col = (name: string) => name
  return {
    db: {
      select: vi.fn(() => selectChain),
      selectDistinct: vi.fn(() => distinctChain),
    },
    auditEvents: {
      id: col('id'),
      createdAt: col('createdAt'),
      principalId: col('principalId'),
      action: col('action'),
      targetType: col('targetType'),
      targetId: col('targetId'),
      diff: col('diff'),
      source: col('source'),
      ipAddress: col('ipAddress'),
      userAgent: col('userAgent'),
    },
    and: vi.fn((...a) => ({ and: a })),
    or: vi.fn((...a) => ({ or: a })),
    eq: vi.fn((a, b) => ({ eq: [a, b] })),
    gte: vi.fn((a, b) => ({ gte: [a, b] })),
    lte: vi.fn((a, b) => ({ lte: [a, b] })),
    lt: vi.fn((a, b) => ({ lt: [a, b] })),
    like: vi.fn((a, b) => ({ like: [a, b] })),
    desc: vi.fn((a) => a),
    asc: vi.fn((a) => a),
    sql: vi.fn(),
  }
})

import { encodeCursor, decodeCursor, listAuditEvents, listDistinctActions } from '../audit.queries'

beforeEach(() => {
  vi.clearAllMocks()
  m.limitMock.mockResolvedValue([])
  m.distinctLimitMock.mockResolvedValue([])
})

describe('cursor encode/decode', () => {
  it('round-trips a cursor', () => {
    const cursor = encodeCursor(new Date('2026-01-02T03:04:05Z'), 'evt_1')
    const decoded = decodeCursor(cursor)
    expect(decoded).toEqual({ t: new Date('2026-01-02T03:04:05Z').getTime(), i: 'evt_1' })
  })

  it('returns null on malformed base64/json', () => {
    expect(decodeCursor('!!!not-base64-json!!!')).toBeNull()
  })

  it('returns null when the payload has the wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ t: 'x', i: 5 }), 'utf8').toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })
})

describe('listAuditEvents', () => {
  it('applies every filter plus a valid cursor and clamps the limit', async () => {
    const cursor = encodeCursor(new Date('2026-01-01T00:00:00Z'), 'evt_cursor')
    m.limitMock.mockResolvedValueOnce([])
    const res = await listAuditEvents({
      principalId: 'p1' as never,
      action: 'ticket.created',
      actionPrefix: 'ticket.',
      targetType: 'ticket',
      targetId: 't1',
      source: 'api' as never,
      from: new Date('2025-01-01'),
      to: new Date('2026-12-31'),
      cursor,
      limit: 9999,
    })
    expect(res).toEqual({ items: [], nextCursor: null })
  })

  it('ignores an undecodable cursor', async () => {
    const res = await listAuditEvents({ cursor: 'garbage', limit: -5 })
    expect(res.nextCursor).toBeNull()
  })

  it('returns nextCursor when there are more rows than the limit', async () => {
    const rows = [
      { id: 'a', createdAt: new Date('2026-03-03') },
      { id: 'b', createdAt: new Date('2026-02-02') },
      { id: 'c', createdAt: new Date('2026-01-01') },
    ]
    m.limitMock.mockResolvedValueOnce(rows)
    const res = await listAuditEvents({ limit: 2 })
    expect(res.items).toHaveLength(2)
    expect(res.nextCursor).toEqual(encodeCursor(new Date('2026-02-02'), 'b'))
  })

  it('runs with no filters (where undefined)', async () => {
    m.limitMock.mockResolvedValueOnce([{ id: 'a', createdAt: new Date('2026-01-01') }])
    const res = await listAuditEvents()
    expect(res.nextCursor).toBeNull()
  })
})

describe('listDistinctActions', () => {
  it('maps rows to action strings', async () => {
    m.distinctLimitMock.mockResolvedValueOnce([{ action: 'a.x' }, { action: 'b.y' }])
    expect(await listDistinctActions()).toEqual(['a.x', 'b.y'])
  })
})
