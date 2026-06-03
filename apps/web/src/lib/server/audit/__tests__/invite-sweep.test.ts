/**
 * `sweepExpiredPortalInvites` — daily sweep that marks stale pending
 * portal invites as 'expired' and emits `portal.invite.expired` per invite.
 *
 * Key behaviors covered:
 *  - Emits one audit row per expired invite with actor.type='system'.
 *  - Bulk-updates status='expired' after auditing.
 *  - Returns 0 and emits nothing when no stale invites exist.
 *  - Best-effort audit: a failed emit doesn't block the status update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// DB mocks
// ---------------------------------------------------------------------------

const mockFindMany = vi.fn()
const mockDbSet = vi.fn()
const mockDbWhere = vi.fn()
const mockDbReturning = vi.fn()
// update chain: db.update(table).set({}).where(...).returning(...)
mockDbWhere.mockReturnValue({ returning: mockDbReturning })
mockDbSet.mockReturnValue({ where: mockDbWhere })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDbUpdate = vi.fn((_table?: any) => ({ set: mockDbSet }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { invitation: { findMany: (a: unknown) => mockFindMany(a) } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (a: unknown) => mockDbUpdate(a as any),
  },
  invitation: { kind: 'kind', status: 'status', expiresAt: 'expiresAt', id: 'id' },
  and: vi.fn((...args: unknown[]) => ({ and: [...args] })),
  or: vi.fn((...args: unknown[]) => ({ or: [...args] })),
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: [col, val] })),
  lt: vi.fn((col: unknown, val: unknown) => ({ lt: [col, val] })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: [col, vals] })),
}))

// ---------------------------------------------------------------------------
// Audit mock
// ---------------------------------------------------------------------------

const mockRecordAuditEvent = vi.fn()
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

// ---------------------------------------------------------------------------
// Import SUT
// ---------------------------------------------------------------------------

const { sweepExpiredPortalInvites } = await import('../invite-sweep')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeInvite(id: string, email: string) {
  return {
    id,
    email,
    kind: 'portal',
    status: 'pending',
    expiresAt: new Date('2020-01-01'),
    createdAt: new Date('2019-12-15'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordAuditEvent.mockResolvedValue(undefined)
  mockDbWhere.mockReturnValue({ returning: mockDbReturning })
  // Default: pretend every row the sweep tried to expire was actually
  // flipped. Individual tests override to exercise the lost-race path.
  mockDbReturning.mockImplementation(async () => {
    const last = mockFindMany.mock.results[mockFindMany.mock.results.length - 1]
    if (last && last.type === 'return') {
      const rows = (await last.value) as Array<{ id: string; email: string; createdAt: Date }>
      return rows
    }
    return []
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sweepExpiredPortalInvites', () => {
  it('emits portal.invite.expired for each pending invite past its expiresAt', async () => {
    const invites = [fakeInvite('invite_1', 'a@x.com'), fakeInvite('invite_2', 'b@x.com')]
    mockFindMany.mockResolvedValueOnce(invites)

    const count = await sweepExpiredPortalInvites()

    expect(count).toBe(2)
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(2)
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.invite.expired',
        actor: expect.objectContaining({ type: 'system' }),
        target: { type: 'invitation', id: 'invite_1' },
        metadata: expect.objectContaining({ email: 'a@x.com', neverAccepted: true }),
      })
    )
  })

  it('marks swept invites as status=expired so they are not picked up again', async () => {
    mockFindMany.mockResolvedValueOnce([fakeInvite('invite_1', 'a@x.com')])

    await sweepExpiredPortalInvites()

    expect(mockDbUpdate).toHaveBeenCalled()
    expect(mockDbSet).toHaveBeenCalledWith({ status: 'expired' })
    expect(mockDbWhere).toHaveBeenCalled()
  })

  it('returns 0 and emits nothing when there are no expired pending invites', async () => {
    mockFindMany.mockResolvedValueOnce([])

    const count = await sweepExpiredPortalInvites()

    expect(count).toBe(0)
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('pins the bulk UPDATE WHERE to status=pending (TOCTOU guard)', async () => {
    // Regression: without the pin, an invite accepted between SELECT and
    // UPDATE gets stamped 'expired', locking out a user who just clicked
    // their magic link. The WHERE clause must include both inArray(ids)
    // AND eq(status, 'pending') so only still-pending rows are swept.
    mockFindMany.mockResolvedValueOnce([
      fakeInvite('invite_1', 'a@x.com'),
      fakeInvite('invite_2', 'b@x.com'),
    ])

    await sweepExpiredPortalInvites()

    expect(mockDbWhere).toHaveBeenCalledTimes(1)
    const whereArg = mockDbWhere.mock.calls[0][0] as { and?: unknown[] }
    expect(whereArg).toHaveProperty('and')
    expect(whereArg.and).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inArray: ['id', ['invite_1', 'invite_2']] }),
        expect.objectContaining({ eq: ['status', 'pending'] }),
      ])
    )
  })

  it('emits team.invite.expired for kind=team invites (not portal.invite.expired)', async () => {
    // Regression: the sweep was widened to cover team invites but
    // every expiry still surfaced as `portal.invite.expired`. Audit
    // reviewers filtering by event type now miss team-invite expiries,
    // and compliance dashboards conflate the two kinds.
    const teamInvite = {
      id: 'invite_team_1',
      email: 'newhire@x.com',
      kind: 'team',
      status: 'pending',
      expiresAt: new Date('2020-01-01'),
      createdAt: new Date('2019-12-15'),
    }
    mockFindMany.mockResolvedValueOnce([teamInvite])
    // The sweep's .returning() must surface kind so we can branch on
    // it. Override the default mock to echo kind back in the row.
    mockDbReturning.mockResolvedValueOnce([
      {
        id: 'invite_team_1',
        email: 'newhire@x.com',
        createdAt: teamInvite.createdAt,
        kind: 'team',
      },
    ])

    await sweepExpiredPortalInvites()

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'team.invite.expired',
        target: { type: 'invitation', id: 'invite_team_1' },
      })
    )
  })

  it('still updates status even when an audit emit fails (best-effort)', async () => {
    mockFindMany.mockResolvedValueOnce([fakeInvite('invite_1', 'a@x.com')])
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    // Should not throw — audit failure is swallowed
    const count = await sweepExpiredPortalInvites()
    expect(count).toBe(1)
    // The status update still proceeds
    expect(mockDbUpdate).toHaveBeenCalled()
    expect(mockDbSet).toHaveBeenCalledWith({ status: 'expired' })
  })
})
