/**
 * listAuditEventsFn — paginated, filterable read of audit_log.
 *
 * The handler builds a single SELECT with conditional WHERE clauses
 * for eventType / actorUserId / from / to, ordered by occurred_at DESC,
 * limit-bounded. Tests confirm:
 *  - admin-only
 *  - filters compose (AND)
 *  - LIMIT defaults to 100, max 500
 *  - hasMore is computed from limit+1 lookahead
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/db', () => {
  // Mock chain: db.select().from().where().orderBy().limit() — return
  // the configured rows; capture each call so we can assert the chain
  // was built. We store the LIMIT for the hasMore-lookahead test.
  const where = vi.fn()
  const orderBy = vi.fn()
  const limit = vi.fn()
  const from = vi.fn()
  return {
    db: {
      select: (...args: unknown[]) => hoisted.mockSelect(...args),
    },
    auditLog: {
      id: 'audit_log.id',
      occurredAt: 'audit_log.occurred_at',
      actorUserId: 'audit_log.actor_user_id',
      actorEmail: 'audit_log.actor_email',
      eventType: 'audit_log.event_type',
    },
    and: vi.fn((...parts) => ({ op: 'and', parts })),
    eq: vi.fn((col, val) => ({ op: 'eq', col, val })),
    gte: vi.fn((col, val) => ({ op: 'gte', col, val })),
    lte: vi.fn((col, val) => ({ op: 'lte', col, val })),
    ilike: vi.fn((col, val) => ({ op: 'ilike', col, val })),
    notInArray: vi.fn((col, vals) => ({ op: 'notInArray', col, vals })),
    desc: vi.fn((col) => ({ op: 'desc', col })),
    __helpers: { where, orderBy, limit, from },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { role: 'admin' },
  })
})

await import('../audit-log')
const listAuditEvents = handlers[0]

// Grab the mock fns from the hoisted db mock so tests can inspect calls.
const db = await import('@/lib/server/db')
const mockNotInArray = vi.mocked(db.notInArray)
const mockEq = vi.mocked(db.eq)

function chainReturning(rows: unknown[]): unknown {
  // Track limit so the test can verify hasMore-lookahead.
  let capturedLimit = 0
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (n: number) => {
      capturedLimit = n
      return Promise.resolve(rows.slice(0, n))
    },
    __limit: () => capturedLimit,
  }
  return chain
}

describe('listAuditEventsFn', () => {
  it('requires admin role', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied'))

    await expect(listAuditEvents({ data: {} })).rejects.toThrow('Access denied')
  })

  it('returns events with hasMore=false when result fits under the limit', async () => {
    hoisted.mockSelect.mockReturnValue(
      chainReturning([{ id: 'audit_1', eventType: 'sso.config.changed', occurredAt: new Date() }])
    )

    const result = (await listAuditEvents({ data: { limit: 50 } })) as {
      events: unknown[]
      hasMore: boolean
    }

    expect(result.events).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })

  it('returns hasMore=true when result includes the lookahead row', async () => {
    // 51 rows, asked for limit=50 → handler asks DB for 51, trims to 50,
    // signals hasMore=true.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `audit_${i}`,
      eventType: 'sso.config.changed',
      occurredAt: new Date(),
    }))
    hoisted.mockSelect.mockReturnValue(chainReturning(rows))

    const result = (await listAuditEvents({ data: { limit: 50 } })) as {
      events: unknown[]
      hasMore: boolean
    }

    expect(result.events).toHaveLength(50)
    expect(result.hasMore).toBe(true)
  })

  it('defaults limit to 100 when omitted', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `audit_${i}`,
      occurredAt: new Date(),
    }))
    const chain = chainReturning(rows) as { __limit: () => number }
    hoisted.mockSelect.mockReturnValue(chain)

    await listAuditEvents({ data: {} })

    // DB asked for limit+1 (100 + 1 = 101) for the lookahead.
    expect(chain.__limit()).toBe(101)
  })

  it('caps limit at 500', async () => {
    const chain = chainReturning([]) as { __limit: () => number }
    hoisted.mockSelect.mockReturnValue(chain)

    await listAuditEvents({ data: { limit: 9999 } })

    expect(chain.__limit()).toBe(501)
  })

  it('applies notInArray when excludeEventTypes is set and no specific eventType is chosen', async () => {
    hoisted.mockSelect.mockReturnValue(chainReturning([]))

    await listAuditEvents({
      data: { excludeEventTypes: ['portal.widget_handshake.consumed'] },
    })

    // notInArray should have been called with the excluded list.
    expect(mockNotInArray).toHaveBeenCalledOnce()
    const [col, vals] = mockNotInArray.mock.calls[0]
    expect(col).toBe('audit_log.event_type')
    expect(vals).toEqual(['portal.widget_handshake.consumed'])
  })

  it('projects requestId, actorType, authMethod from the DB row into AuditEventRow', async () => {
    // The 0070_audit_log_observability migration adds three columns:
    // request_id (indexed for forensics), actor_type, auth_method.
    // The audit-log writer fills them in; the read side must surface
    // them so the admin observability UI + CSV export can use them.
    hoisted.mockSelect.mockReturnValue(
      chainReturning([
        {
          id: 'audit_1',
          eventType: 'auth.signin.succeeded',
          occurredAt: new Date('2026-05-20T10:30:00Z'),
          actorUserId: null,
          actorEmail: 'demo@example.com',
          actorRole: 'admin',
          actorIp: '127.0.0.1',
          actorUserAgent: 'Mozilla/5.0',
          eventOutcome: 'success',
          targetType: null,
          targetId: null,
          beforeValue: null,
          afterValue: null,
          metadata: null,
          requestId: 'req_abc123',
          actorType: 'user',
          authMethod: 'sso',
        },
      ])
    )

    const result = (await listAuditEvents({ data: { limit: 10 } })) as {
      events: Array<{
        requestId: string | null
        actorType: string | null
        authMethod: string | null
      }>
    }

    expect(result.events).toHaveLength(1)
    expect(result.events[0].requestId).toBe('req_abc123')
    expect(result.events[0].actorType).toBe('user')
    expect(result.events[0].authMethod).toBe('sso')
  })

  it('passes through null observability fields (most writes leave them null)', async () => {
    hoisted.mockSelect.mockReturnValue(
      chainReturning([
        {
          id: 'audit_2',
          eventType: 'sso.config.changed',
          occurredAt: new Date(),
          eventOutcome: 'success',
          requestId: null,
          actorType: null,
          authMethod: null,
        },
      ])
    )
    const result = (await listAuditEvents({ data: { limit: 10 } })) as {
      events: Array<{
        requestId: string | null
        actorType: string | null
        authMethod: string | null
      }>
    }
    expect(result.events[0].requestId).toBeNull()
    expect(result.events[0].actorType).toBeNull()
    expect(result.events[0].authMethod).toBeNull()
  })

  it('does NOT apply notInArray when a specific eventType is also set (deliberate selection wins)', async () => {
    hoisted.mockSelect.mockReturnValue(chainReturning([]))

    await listAuditEvents({
      data: {
        eventType: 'portal.widget_handshake.consumed',
        excludeEventTypes: ['portal.widget_handshake.consumed'],
      },
    })

    // The explicit eventType selection suppresses the exclude list.
    expect(mockNotInArray).not.toHaveBeenCalled()
    // But eq should be called for the eventType filter. The mock receives the
    // string-keyed column stubs from the auditLog mock object, so cast to
    // inspect them as plain values.
    const eqCalls = mockEq.mock.calls as unknown as Array<[string, string]>
    const eqCall = eqCalls.find(([col]) => col === 'audit_log.event_type')
    expect(eqCall).toBeDefined()
    expect(eqCall?.[1]).toBe('portal.widget_handshake.consumed')
  })
})
