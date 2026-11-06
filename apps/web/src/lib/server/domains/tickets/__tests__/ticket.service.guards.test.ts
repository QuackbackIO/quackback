/**
 * Permission-guard branches for the ticket service (no db). Each write re-checks
 * its `ticket.*` permission before touching the database, so an actor without it
 * is denied before any query runs — exercised here with the spread db mock
 * (see server/__tests__/README.md).
 */
import { describe, it, expect, vi } from 'vitest'
import { createId, type PrincipalId, type TicketId, type TicketStatusId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  // Guards throw before any db access, so a stub is never dereferenced.
  db: {},
}))

import {
  createTicket,
  setTicketStatus,
  assignTicket,
  setTicketPriority,
  softDeleteTicket,
  bulkUpdateTickets,
} from '../ticket.service'
import { setTicketDueAt } from '../ticket-due.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const powerless: Actor = {
  principalId: createId('principal') as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

const ticketId = createId('ticket') as TicketId
const statusId = createId('ticket_status') as TicketStatusId

describe('ticket service permission guards', () => {
  it('createTicket denies an actor without ticket.create', async () => {
    await expect(createTicket({ type: 'customer', title: 'x' }, powerless)).rejects.toThrow(
      /cannot create a ticket/i
    )
  })

  it('setTicketStatus denies an actor without ticket.set_status', async () => {
    await expect(setTicketStatus(ticketId, statusId, powerless)).rejects.toThrow(
      /cannot change this ticket status/i
    )
  })

  it('assignTicket denies an actor without ticket.assign', async () => {
    await expect(assignTicket(ticketId, { assigneeTeamId: null }, powerless)).rejects.toThrow(
      /cannot assign this ticket/i
    )
  })

  it('setTicketPriority denies an actor without ticket.set_status', async () => {
    await expect(setTicketPriority(ticketId, 'high', powerless)).rejects.toThrow(
      /cannot change this ticket priority/i
    )
  })

  it('softDeleteTicket denies an actor without ticket.set_status', async () => {
    await expect(softDeleteTicket(ticketId, powerless)).rejects.toThrow(
      /cannot delete this ticket/i
    )
  })

  it('setTicketDueAt denies an actor without ticket.set_status, for a set and a clear', async () => {
    await expect(
      setTicketDueAt(ticketId, new Date(Date.now() + 86_400_000), powerless)
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/due date/i) })
    await expect(setTicketDueAt(ticketId, null, powerless)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('setTicketDueAt rejects an out-of-window date before loading the ticket', async () => {
    const admin: Actor = {
      ...powerless,
      role: 'admin',
      permissions: resolveActorPermissions('admin'),
    }
    const now = new Date('2026-10-14T12:00:00.000Z')
    const sixYearsOut = new Date(now.getTime() + 6 * 365 * 86_400_000)
    await expect(setTicketDueAt(ticketId, sixYearsOut, admin, { now })).rejects.toMatchObject({
      code: 'INVALID_DUE_DATE',
    })
  })
})

describe('bulkUpdateTickets: does not bypass the single-item authz it loops', () => {
  it('captures every item Forbidden in `failed` rather than throwing or silently succeeding', async () => {
    const otherId = createId('ticket') as TicketId
    const result = await bulkUpdateTickets(
      [ticketId, otherId],
      { type: 'assign', assignTo: null },
      powerless
    )
    expect(result.succeeded).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.failed.map((f) => f.id)).toEqual([ticketId, otherId])
    for (const f of result.failed) {
      expect(f.reason).toMatch(/cannot assign this ticket/i)
    }
  })

  it('assign_team is denied by the same ticket.assign guard as assign', async () => {
    const result = await bulkUpdateTickets(
      [ticketId],
      { type: 'assign_team', teamId: null },
      powerless
    )
    expect(result.failed).toEqual([
      { id: ticketId, reason: expect.stringMatching(/cannot assign this ticket/i) },
    ])
  })

  it('priority is denied by the ticket.set_status guard', async () => {
    const result = await bulkUpdateTickets(
      [ticketId],
      { type: 'priority', priority: 'high' },
      powerless
    )
    expect(result.failed).toEqual([
      { id: ticketId, reason: expect.stringMatching(/cannot change this ticket priority/i) },
    ])
  })

  it('set_due is denied by the ticket.set_status guard', async () => {
    const result = await bulkUpdateTickets([ticketId], { type: 'set_due', dueAt: null }, powerless)
    expect(result.failed).toEqual([
      { id: ticketId, reason: expect.stringMatching(/cannot change this ticket due date/i) },
    ])
  })

  it('set_status is denied by the ticket.set_status guard', async () => {
    const result = await bulkUpdateTickets([ticketId], { type: 'set_status', statusId }, powerless)
    expect(result.failed).toEqual([
      { id: ticketId, reason: expect.stringMatching(/cannot change this ticket status/i) },
    ])
  })
})
