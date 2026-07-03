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
} from '../ticket.service'
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
})
