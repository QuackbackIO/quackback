/**
 * ticket.share — verifies idempotent share, idempotent revoke, and the
 * "no duplicate active grant" invariant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sharesFindFirstMock = vi.fn()
const ticketsFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketShares: { findFirst: sharesFindFirstMock },
      tickets: { findFirst: ticketsFindFirstMock },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: updateReturningMock,
    })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  ticketShares: { _name: 'ticket_shares' },
  tickets: { _name: 'tickets', id: 'tickets.id' },
  TICKET_SHARE_LEVELS: ['read', 'comment', 'full'] as const,
}))

vi.mock('../../audit', () => ({ recordEvent: vi.fn() }))
vi.mock('../ticket.service', () => ({
  writeActivity: vi.fn().mockResolvedValue({ id: 'act' }),
  bumpLastActivity: vi.fn(),
}))
vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E }
})

beforeEach(() => {
  vi.clearAllMocks()
  sharesFindFirstMock.mockReset()
  ticketsFindFirstMock.mockReset()
  insertReturningMock.mockReset()
  updateReturningMock.mockReset()
})

describe('shareTicketWithTeam', () => {
  it('returns the existing active grant rather than inserting a duplicate', async () => {
    ticketsFindFirstMock.mockResolvedValueOnce({ id: 'ticket_1', deletedAt: null })
    sharesFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_share_1',
      ticketId: 'ticket_1',
      teamId: 'team_y',
      accessLevel: 'read',
      revokedAt: null,
    })
    const { shareTicketWithTeam } = await import('../ticket.share')
    const result = await shareTicketWithTeam({
      ticketId: 'ticket_1' as never,
      teamId: 'team_y' as never,
      grantedByPrincipalId: 'user_a' as never,
    })
    expect(result.id).toBe('ticket_share_1')
    expect(insertReturningMock).not.toHaveBeenCalled()
  })

  it('inserts a new grant when none exists', async () => {
    ticketsFindFirstMock.mockResolvedValueOnce({ id: 'ticket_1', deletedAt: null })
    sharesFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([
      { id: 'ticket_share_new', accessLevel: 'comment', teamId: 'team_y' },
    ])
    const { shareTicketWithTeam } = await import('../ticket.share')
    const result = await shareTicketWithTeam({
      ticketId: 'ticket_1' as never,
      teamId: 'team_y' as never,
      accessLevel: 'comment',
      grantedByPrincipalId: 'user_a' as never,
    })
    expect(result.id).toBe('ticket_share_new')
  })

  it('rejects unknown ticket', async () => {
    ticketsFindFirstMock.mockResolvedValueOnce(undefined)
    const { shareTicketWithTeam } = await import('../ticket.share')
    await expect(
      shareTicketWithTeam({
        ticketId: 'ticket_missing' as never,
        teamId: 'team_y' as never,
        grantedByPrincipalId: null,
      })
    ).rejects.toThrow(/not found/i)
  })
})

describe('revokeShare', () => {
  it('is idempotent — re-revoking returns the same row without writing', async () => {
    sharesFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_share_1',
      ticketId: 'ticket_1',
      teamId: 'team_y',
      revokedAt: new Date('2026-04-30T00:00:00.000Z'),
    })
    const { revokeShare } = await import('../ticket.share')
    const result = await revokeShare('ticket_share_1' as never, null)
    expect(result.id).toBe('ticket_share_1')
    expect(updateReturningMock).not.toHaveBeenCalled()
  })

  it('marks an active grant as revoked', async () => {
    sharesFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_share_1',
      ticketId: 'ticket_1',
      teamId: 'team_y',
      revokedAt: null,
    })
    updateReturningMock.mockResolvedValueOnce([
      { id: 'ticket_share_1', revokedAt: new Date(), revokedByPrincipalId: 'user_a' },
    ])
    const { revokeShare } = await import('../ticket.share')
    const result = await revokeShare('ticket_share_1' as never, 'user_a' as never)
    expect(result.revokedAt).not.toBeNull()
  })
})
