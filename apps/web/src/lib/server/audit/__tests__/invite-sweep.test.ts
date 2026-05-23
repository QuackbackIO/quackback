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
// update chain: db.update(table).set({}).where()
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
  mockDbWhere.mockResolvedValue(undefined)
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
