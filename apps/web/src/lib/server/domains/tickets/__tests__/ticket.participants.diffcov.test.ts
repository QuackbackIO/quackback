/**
 * Differential-coverage tests for ticket.participants — add/remove/list with
 * the validation guards, idempotency, audit + activity writes, auto-subscribe,
 * notification dispatch (principal vs service actor), and the defensive
 * try/catch fallbacks around the notification + webhook side-effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  participantsFindFirst: vi.fn(),
  ticketsFindFirst: vi.fn(),
  returningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  selectWhereMock: vi.fn(),
  recordEvent: vi.fn(),
  writeActivity: vi.fn(),
  bumpLastActivity: vi.fn(),
  safeSubscribe: vi.fn(),
  notifyAdded: vi.fn(),
  notifyRemoved: vi.fn(),
  dispatchAdded: vi.fn(),
  dispatchRemoved: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({
    type: 'principal',
    displayName: 'ticket-system',
  })),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketParticipants: { findFirst: m.participantsFindFirst },
      tickets: { findFirst: m.ticketsFindFirst },
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: m.returningMock })) })),
    delete: vi.fn(() => ({ where: m.deleteWhereMock })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: m.selectWhereMock })) })),
  },
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...a) => ({ and: a })),
  tickets: { id: 'tickets.id' },
  ticketParticipants: {
    id: 'tp.id',
    ticketId: 'tp.ticketId',
    principalId: 'tp.principalId',
    contactId: 'tp.contactId',
  },
  TICKET_PARTICIPANT_ROLES: ['collaborator', 'watcher', 'cc'],
}))

vi.mock('../../audit', () => ({ recordEvent: (...a: unknown[]) => m.recordEvent(...a) }))
vi.mock('../ticket.service', () => ({
  writeActivity: (...a: unknown[]) => m.writeActivity(...a),
  bumpLastActivity: (...a: unknown[]) => m.bumpLastActivity(...a),
}))
vi.mock('../ticket.subscriptions', () => ({
  safeSubscribe: (...a: unknown[]) => m.safeSubscribe(...a),
}))
vi.mock('../ticket.notifications', () => ({
  notifyParticipantAdded: (...a: unknown[]) => m.notifyAdded(...a),
  notifyParticipantRemoved: (...a: unknown[]) => m.notifyRemoved(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTicketParticipantAdded: (...a: unknown[]) => m.dispatchAdded(...a),
  dispatchTicketParticipantRemoved: (...a: unknown[]) => m.dispatchRemoved(...a),
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
}))

import { addParticipant, removeParticipant, listParticipants } from '../ticket.participants'

const tid = 'ticket_1' as never

beforeEach(() => {
  vi.clearAllMocks()
  m.participantsFindFirst.mockResolvedValue(undefined)
  m.ticketsFindFirst.mockResolvedValue({ id: 'ticket_1' })
  m.returningMock.mockResolvedValue([{ id: 'tp_1' }])
  m.deleteWhereMock.mockResolvedValue(undefined)
  m.selectWhereMock.mockResolvedValue([{ id: 'tp_1' }])
  m.safeSubscribe.mockResolvedValue(undefined)
  m.notifyAdded.mockResolvedValue(undefined)
  m.notifyRemoved.mockResolvedValue(undefined)
  m.dispatchAdded.mockResolvedValue(undefined)
  m.dispatchRemoved.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('addParticipant validation', () => {
  it('rejects an invalid role', async () => {
    await expect(
      addParticipant({
        ticketId: tid,
        role: 'bogus' as never,
        principalId: 'p1' as never,
        addedByPrincipalId: null,
      })
    ).rejects.toThrow('invalid role')
  })

  it('rejects when both principalId and contactId are set', async () => {
    await expect(
      addParticipant({
        ticketId: tid,
        role: 'watcher',
        principalId: 'p1' as never,
        contactId: 'c1' as never,
        addedByPrincipalId: null,
      })
    ).rejects.toThrow('exactly one')
  })

  it('rejects when neither subject is set', async () => {
    await expect(
      addParticipant({ ticketId: tid, role: 'watcher', addedByPrincipalId: null })
    ).rejects.toThrow('exactly one')
  })

  it('is idempotent — returns the existing row', async () => {
    m.participantsFindFirst.mockResolvedValueOnce({ id: 'tp_existing' })
    const res = await addParticipant({
      ticketId: tid,
      role: 'watcher',
      principalId: 'p1' as never,
      addedByPrincipalId: null,
    })
    expect(res).toEqual({ id: 'tp_existing' })
    expect(m.returningMock).not.toHaveBeenCalled()
  })
})

describe('addParticipant success paths', () => {
  it('creates with a principal, auto-subscribes, notifies, and dispatches a principal actor', async () => {
    const res = await addParticipant({
      ticketId: tid,
      role: 'collaborator',
      principalId: 'p1' as never,
      addedByPrincipalId: 'actor_1' as never,
    })
    expect(res).toEqual({ id: 'tp_1' })
    expect(m.bumpLastActivity).toHaveBeenCalledWith(tid)
    expect(m.writeActivity).toHaveBeenCalled()
    expect(m.recordEvent).toHaveBeenCalled()
    expect(m.safeSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'auto_participant' })
    )
    expect(m.notifyAdded).toHaveBeenCalled()
    expect(m.buildEventActor).toHaveBeenCalled()
    expect(m.dispatchAdded).toHaveBeenCalled()
  })

  it('creates with a contact and a null actor (service actor, no auto-subscribe)', async () => {
    await addParticipant({
      ticketId: tid,
      role: 'cc',
      contactId: 'c1' as never,
      addedByPrincipalId: null,
    })
    expect(m.safeSubscribe).not.toHaveBeenCalled()
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(m.dispatchAdded).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service' }),
      expect.anything(),
      null,
      'cc'
    )
  })

  it('skips notifications when the ticket row is missing', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await addParticipant({
      ticketId: tid,
      role: 'watcher',
      principalId: 'p1' as never,
      addedByPrincipalId: 'a1' as never,
    })
    expect(m.notifyAdded).not.toHaveBeenCalled()
  })

  it('swallows a dispatch failure (inner catch)', async () => {
    m.dispatchAdded.mockRejectedValueOnce(new Error('boom'))
    const res = await addParticipant({
      ticketId: tid,
      role: 'watcher',
      principalId: 'p1' as never,
      addedByPrincipalId: 'a1' as never,
    })
    expect(res).toEqual({ id: 'tp_1' })
    expect(console.warn).toHaveBeenCalled()
  })

  it('swallows a notify failure (outer catch)', async () => {
    m.notifyAdded.mockRejectedValueOnce(new Error('notify-fail'))
    const res = await addParticipant({
      ticketId: tid,
      role: 'watcher',
      principalId: 'p1' as never,
      addedByPrincipalId: 'a1' as never,
    })
    expect(res).toEqual({ id: 'tp_1' })
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('removeParticipant', () => {
  it('throws when the participant is missing', async () => {
    m.participantsFindFirst.mockResolvedValueOnce(undefined)
    await expect(removeParticipant('tp_x' as never, null)).rejects.toThrow('not found')
  })

  it('deletes, records, and dispatches the removed notification', async () => {
    m.participantsFindFirst.mockResolvedValueOnce({
      id: 'tp_1',
      ticketId: 'ticket_1',
      principalId: 'p1',
      contactId: null,
    })
    await removeParticipant('tp_1' as never, 'actor_1' as never)
    expect(m.deleteWhereMock).toHaveBeenCalled()
    expect(m.recordEvent).toHaveBeenCalled()
    expect(m.notifyRemoved).toHaveBeenCalled()
    expect(m.dispatchRemoved).toHaveBeenCalled()
  })

  it('uses a service actor and skips notify when the ticket row is gone', async () => {
    m.participantsFindFirst.mockResolvedValueOnce({
      id: 'tp_1',
      ticketId: 'ticket_1',
      principalId: null,
      contactId: 'c1',
    })
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await removeParticipant('tp_1' as never, null)
    expect(m.notifyRemoved).not.toHaveBeenCalled()
  })

  it('swallows a dispatch failure', async () => {
    m.participantsFindFirst.mockResolvedValueOnce({
      id: 'tp_1',
      ticketId: 'ticket_1',
      principalId: 'p1',
      contactId: null,
    })
    m.dispatchRemoved.mockRejectedValueOnce(new Error('boom'))
    await removeParticipant('tp_1' as never, 'a1' as never)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('listParticipants', () => {
  it('returns the rows from the select chain', async () => {
    const res = await listParticipants(tid)
    expect(res).toEqual([{ id: 'tp_1' }])
  })
})
