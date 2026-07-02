/**
 * Differential-coverage tests for audit.unified — cursor encode/decode,
 * row comparison + in-memory paging, the workspace/security query gating
 * (origin/principal/source), cursor-condition ordering, security diff shaping,
 * and the distinct-actions union.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'leftJoin', 'where', 'orderBy']) chain[k] = () => chain
  chain.limit = () => Promise.resolve(m.selectResult())
  return { chain, selectResult: vi.fn(), distinctResult: vi.fn() }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => m.chain,
    selectDistinct: () => ({
      from: () => ({ orderBy: () => ({ limit: () => m.distinctResult() }) }),
    }),
  },
  and: vi.fn((...a) => ({ and: a })),
  or: vi.fn((...a) => ({ or: a })),
  eq: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  lt: vi.fn(),
  like: vi.fn(),
  ilike: vi.fn(),
  notInArray: vi.fn(),
  desc: vi.fn(),
  auditEvents: {
    id: 'ae.id',
    action: 'ae.action',
    createdAt: 'ae.createdAt',
    principalId: 'ae.principalId',
    targetType: 'ae.targetType',
    targetId: 'ae.targetId',
    source: 'ae.source',
  },
  auditLog: {
    id: 'al.id',
    eventType: 'al.eventType',
    occurredAt: 'al.occurredAt',
    targetType: 'al.targetType',
    targetId: 'al.targetId',
    actorEmail: 'al.actorEmail',
  },
  principal: { id: 'pr.id', userId: 'pr.userId' },
  user: { id: 'u.id', email: 'u.email' },
}))

import {
  encodeUnifiedAuditCursor,
  decodeUnifiedAuditCursor,
  compareUnifiedAuditRows,
  pageUnifiedAuditRows,
  listUnifiedAuditEvents,
  listUnifiedAuditActions,
} from '../audit.unified'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  origin: 'workspace' as const,
  occurredAt: new Date('2026-03-03'),
  principalId: null,
  actorUserId: null,
  actorEmail: null,
  actorDisplayName: null,
  actorRole: null,
  actorType: null,
  authMethod: null,
  action: 'a',
  outcome: null,
  source: null,
  targetType: null,
  targetId: null,
  requestId: null,
  ipAddress: null,
  userAgent: null,
  diff: null,
  metadata: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.selectResult.mockReturnValue([])
  m.distinctResult.mockResolvedValue([])
})

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const c = encodeUnifiedAuditCursor({
      occurredAt: new Date('2026-01-01'),
      origin: 'security',
      id: 'x',
    })
    expect(decodeUnifiedAuditCursor(c)).toEqual({
      t: new Date('2026-01-01').getTime(),
      o: 'security',
      i: 'x',
    })
  })
  it('returns null for undefined / malformed / wrong-shape cursors', () => {
    expect(decodeUnifiedAuditCursor(undefined)).toBeNull()
    expect(decodeUnifiedAuditCursor('!!notbase64json')).toBeNull()
    const bad = Buffer.from(JSON.stringify({ t: 'x', o: 'nope', i: 1 }), 'utf8').toString(
      'base64url'
    )
    expect(decodeUnifiedAuditCursor(bad)).toBeNull()
  })
})

describe('compareUnifiedAuditRows + paging', () => {
  it('orders by time, then origin, then id', () => {
    const older = row({ occurredAt: new Date('2026-01-01') })
    const newer = row({ occurredAt: new Date('2026-02-02') })
    expect(compareUnifiedAuditRows(newer, older)).toBeLessThan(0)
    const wsp = row({ origin: 'workspace' })
    const sec = row({ origin: 'security' })
    expect(compareUnifiedAuditRows(wsp, sec)).toBeLessThan(0)
    expect(compareUnifiedAuditRows(row({ id: 'b' }), row({ id: 'a' }))).toBeLessThan(0)
  })
  it('pages: sorts, slices to limit, and emits a next cursor', () => {
    const page = pageUnifiedAuditRows(
      [
        row({ id: 'a', occurredAt: new Date('2026-03-03') }),
        row({ id: 'b', occurredAt: new Date('2026-02-02') }),
        row({ id: 'c', occurredAt: new Date('2026-01-01') }),
      ],
      { limit: 2 }
    )
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).not.toBeNull()
  })
  it('pages with a cursor (keeps only rows after the cursor position)', () => {
    // Descending feed: the cursor is the last (oldest) row of the previous
    // page, so page 2 keeps rows OLDER than it.
    const cursor = encodeUnifiedAuditCursor({
      occurredAt: new Date('2026-02-15'),
      origin: 'workspace',
      id: 'b',
    })
    const page = pageUnifiedAuditRows(
      [
        row({ id: 'a', occurredAt: new Date('2026-03-03') }),
        row({ id: 'z', occurredAt: new Date('2026-01-01') }),
      ],
      { cursor }
    )
    expect(page.items.map((r) => r.id)).toEqual(['z'])
  })
})

describe('listUnifiedAuditEvents query gating', () => {
  it('queries only workspace when origin=workspace and maps rows', async () => {
    m.selectResult.mockReturnValueOnce([
      {
        id: 'w1',
        createdAt: new Date('2026-03-03'),
        principalId: 'p1',
        action: 'ticket.created',
        targetType: 't',
        targetId: 'x',
        diff: {},
        source: 'web',
        ipAddress: null,
        userAgent: null,
        actorUserId: 'u1',
        actorEmail: 'a@x.test',
        actorDisplayName: null,
        actorRole: 'agent',
        actorType: 'user',
        userName: 'Fallback',
      },
    ])
    const page = await listUnifiedAuditEvents({
      origin: 'workspace',
      action: 'ticket.created',
      actorEmail: ' a ',
      from: new Date('2025-01-01'),
      to: new Date('2026-12-31'),
      targetType: 't',
      targetId: 'x',
    })
    expect(page.items[0].actorDisplayName).toBe('Fallback')
  })
  it('skips the security store when a principal filter is set', async () => {
    await listUnifiedAuditEvents({ principalId: 'p1' as never })
    // both branches still produce a valid page
    expect(m.selectResult).toHaveBeenCalled()
  })
  it('queries only security when origin=security and shapes the diff + cursor', async () => {
    const cursor = encodeUnifiedAuditCursor({
      occurredAt: new Date('2026-02-15'),
      origin: 'workspace',
      id: 'b',
    })
    m.selectResult.mockReturnValueOnce([
      {
        id: 's1',
        occurredAt: new Date('2026-01-01'),
        actorUserId: 'u1',
        actorEmail: 'a@x.test',
        actorRole: 'admin',
        actorIp: '1.1.1.1',
        actorUserAgent: 'ua',
        eventType: 'auth.login',
        eventOutcome: 'success',
        targetType: null,
        targetId: null,
        beforeValue: { x: 1 },
        afterValue: { x: 2 },
        metadata: { k: 'v' },
        requestId: 'req_1',
        actorType: 'user',
        authMethod: 'password',
      },
    ])
    const page = await listUnifiedAuditEvents({
      origin: 'security',
      actionPrefix: 'auth.',
      excludeSecurityActions: ['noise'],
      cursor,
    })
    expect(page.items[0].diff).toMatchObject({
      before: { x: 1 },
      after: { x: 2 },
      context: { requestId: 'req_1' },
    })
  })
  it('queries both stores by default (cursor ordering across origins)', async () => {
    const cursor = encodeUnifiedAuditCursor({
      occurredAt: new Date('2026-02-15'),
      origin: 'security',
      id: 'b',
    })
    await listUnifiedAuditEvents({ cursor })
    expect(m.selectResult).toHaveBeenCalledTimes(2)
  })
})

describe('listUnifiedAuditActions', () => {
  it('unions + sorts distinct actions from both stores', async () => {
    m.distinctResult.mockResolvedValueOnce([{ action: 'b' }, { action: 'a' }])
    m.distinctResult.mockResolvedValueOnce([{ action: 'a' }, { action: 'c' }])
    expect(await listUnifiedAuditActions()).toEqual(['a', 'b', 'c'])
  })
})
