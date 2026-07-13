/**
 * Differential-coverage tests for ticket.share — share (invalid level, missing
 * ticket, idempotent existing grant, create + notify/dispatch), revoke (missing,
 * already-revoked, success + notify/dispatch), and the list helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  ticketsFindFirst: vi.fn(),
  sharesFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectOrderBy: vi.fn(),
  recordEvent: vi.fn(),
  writeActivity: vi.fn(),
  bumpLastActivity: vi.fn(),
  notifyShared: vi.fn((..._a: unknown[]) => Promise.resolve()),
  notifyUnshared: vi.fn((..._a: unknown[]) => Promise.resolve()),
  buildEventActor: vi.fn((..._a: unknown[]) => ({ type: 'user' })),
  dShared: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dUnshared: vi.fn((..._a: unknown[]) => Promise.resolve()),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      tickets: { findFirst: m.ticketsFindFirst },
      ticketShares: { findFirst: m.sharesFindFirst },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => m.selectOrderBy() }) }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  ticketShares: {
    id: 'ts.id',
    ticketId: 'ts.ticketId',
    teamId: 'ts.teamId',
    revokedAt: 'ts.revokedAt',
    createdAt: 'ts.createdAt',
  },
  tickets: { id: 't.id', deletedAt: 't.deletedAt' },
  TICKET_SHARE_LEVELS: ['read', 'comment', 'edit'],
}))
vi.mock('../../audit', () => ({ recordEvent: (...a: unknown[]) => m.recordEvent(...a) }))
vi.mock('../ticket.service', () => ({
  writeActivity: (...a: unknown[]) => m.writeActivity(...a),
  bumpLastActivity: (...a: unknown[]) => m.bumpLastActivity(...a),
}))
vi.mock('../ticket.notifications', () => ({
  notifyTicketShared: (...a: unknown[]) => m.notifyShared(...a),
  notifyTicketUnshared: (...a: unknown[]) => m.notifyUnshared(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTicketShared: (...a: unknown[]) => m.dShared(...a),
  dispatchTicketUnshared: (...a: unknown[]) => m.dUnshared(...a),
}))

import {
  shareTicketWithTeam,
  revokeShare,
  listSharesForTicket,
  listTicketsSharedWithTeam,
} from '../ticket.share'

beforeEach(() => {
  vi.clearAllMocks()
  m.ticketsFindFirst.mockResolvedValue({ id: 'ticket_1' })
  m.sharesFindFirst.mockResolvedValue(undefined)
  m.insertReturning.mockResolvedValue([{ id: 'share_1', accessLevel: 'read' }])
  m.updateReturning.mockResolvedValue([{ id: 'share_1' }])
  m.selectOrderBy.mockResolvedValue([{ id: 'share_1' }])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('shareTicketWithTeam', () => {
  it('rejects an invalid access level', async () => {
    await expect(
      shareTicketWithTeam({ ticketId: 't', teamId: 'team_1', accessLevel: 'bogus' } as never)
    ).rejects.toThrow('invalid accessLevel')
  })
  it('throws when the ticket is missing', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      shareTicketWithTeam({ ticketId: 't', teamId: 'team_1', grantedByPrincipalId: null } as never)
    ).rejects.toThrow('not found')
  })
  it('returns the existing grant idempotently', async () => {
    m.sharesFindFirst.mockResolvedValueOnce({ id: 'existing' })
    const res = await shareTicketWithTeam({
      ticketId: 'ticket_1',
      teamId: 'team_1',
      grantedByPrincipalId: null,
    } as never)
    expect(res).toEqual({ id: 'existing' })
    expect(m.insertReturning).not.toHaveBeenCalled()
  })
  it('creates a grant and dispatches (principal actor)', async () => {
    await shareTicketWithTeam({
      ticketId: 'ticket_1',
      teamId: 'team_1',
      grantedByPrincipalId: 'p1',
    } as never)
    expect(m.notifyShared).toHaveBeenCalled()
    expect(m.dShared).toHaveBeenCalled()
  })
  it('swallows notify + dispatch failures (service actor)', async () => {
    m.notifyShared.mockRejectedValueOnce(new Error('notify'))
    m.dShared.mockRejectedValueOnce(new Error('dispatch'))
    await shareTicketWithTeam({
      ticketId: 'ticket_1',
      teamId: 'team_1',
      grantedByPrincipalId: null,
    } as never)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('revokeShare', () => {
  it('throws when the share is missing', async () => {
    m.sharesFindFirst.mockResolvedValueOnce(undefined)
    await expect(revokeShare('share_1' as never, null)).rejects.toThrow('not found')
  })
  it('is idempotent when already revoked', async () => {
    m.sharesFindFirst.mockResolvedValueOnce({ id: 'share_1', revokedAt: new Date() })
    const res = await revokeShare('share_1' as never, null)
    expect(res).toMatchObject({ id: 'share_1' })
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('revokes and dispatches when the ticket still exists', async () => {
    m.sharesFindFirst.mockResolvedValueOnce({
      id: 'share_1',
      revokedAt: null,
      ticketId: 'ticket_1',
      teamId: 'team_1',
    })
    m.ticketsFindFirst.mockResolvedValueOnce({ id: 'ticket_1' })
    await revokeShare('share_1' as never, 'p1' as never)
    expect(m.notifyUnshared).toHaveBeenCalled()
    expect(m.dUnshared).toHaveBeenCalled()
  })
  it('skips the notification when the ticket is gone', async () => {
    m.sharesFindFirst.mockResolvedValueOnce({
      id: 'share_1',
      revokedAt: null,
      ticketId: 'ticket_1',
      teamId: 'team_1',
    })
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await revokeShare('share_1' as never, null)
    expect(m.notifyUnshared).not.toHaveBeenCalled()
  })
})

describe('list helpers', () => {
  it('listSharesForTicket / listTicketsSharedWithTeam return rows', async () => {
    expect(await listSharesForTicket('ticket_1' as never)).toEqual([{ id: 'share_1' }])
    expect(await listTicketsSharedWithTeam('team_1' as never)).toEqual([{ id: 'share_1' }])
  })
})
