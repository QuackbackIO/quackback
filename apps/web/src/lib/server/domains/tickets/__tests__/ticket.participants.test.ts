/**
 * ticket.participants — exactly-one invariant + idempotent re-add.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const partFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { ticketParticipants: { findFirst: partFindFirstMock } },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  ticketParticipants: { _name: 'ticket_participants' },
  tickets: { _name: 'tickets', id: 'tickets.id' },
  TICKET_PARTICIPANT_ROLES: ['watcher', 'collaborator', 'cc'] as const,
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
  partFindFirstMock.mockReset()
  insertReturningMock.mockReset()
})

describe('addParticipant', () => {
  it('rejects when both principalId and contactId are set', async () => {
    const { addParticipant } = await import('../ticket.participants')
    await expect(
      addParticipant({
        ticketId: 'ticket_1' as never,
        role: 'watcher',
        principalId: 'user_a' as never,
        contactId: 'contact_a' as never,
        addedByPrincipalId: null,
      })
    ).rejects.toThrow(/exactly one/i)
  })

  it('rejects when neither principalId nor contactId is set', async () => {
    const { addParticipant } = await import('../ticket.participants')
    await expect(
      addParticipant({
        ticketId: 'ticket_1' as never,
        role: 'watcher',
        addedByPrincipalId: null,
      })
    ).rejects.toThrow(/exactly one/i)
  })

  it('returns existing row idempotently', async () => {
    partFindFirstMock.mockResolvedValueOnce({
      id: 'ticket_part_1',
      ticketId: 'ticket_1',
      principalId: 'user_a',
      role: 'watcher',
    })
    const { addParticipant } = await import('../ticket.participants')
    const result = await addParticipant({
      ticketId: 'ticket_1' as never,
      role: 'watcher',
      principalId: 'user_a' as never,
      addedByPrincipalId: null,
    })
    expect(result.id).toBe('ticket_part_1')
    expect(insertReturningMock).not.toHaveBeenCalled()
  })

  it('inserts when no matching row exists', async () => {
    partFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([
      { id: 'ticket_part_new', ticketId: 'ticket_1', principalId: 'user_a' },
    ])
    const { addParticipant } = await import('../ticket.participants')
    const result = await addParticipant({
      ticketId: 'ticket_1' as never,
      role: 'collaborator',
      principalId: 'user_a' as never,
      addedByPrincipalId: 'user_b' as never,
    })
    expect(result.id).toBe('ticket_part_new')
  })
})
