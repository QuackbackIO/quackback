/**
 * Real-DB coverage for the requester-facing ticket service (§4.2, 7C): ownership
 * gating (a requester only ever reaches their own customer tickets), the
 * internal-note strip on the requester thread, and the visitor-authored requester
 * reply. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  principal,
  user,
  settings,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  listMyTickets,
  getMyTicket,
  getMyTicketThread,
  replyToMyTicket,
} from '../requester.service'
import { sendTicketMessage, addTicketNote } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

/** An agent actor with reply/note perms, to seed thread messages on a ticket. */
function agentActor(principalId: PrincipalId): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_REPLY, PERMISSIONS.TICKET_NOTE]),
  }
}

async function seedWorld() {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
  const me = await seedPrincipal()
  const other = await seedPrincipal()
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `s_${suffix()}` })
  const mine = createId('ticket') as TicketId
  const theirs = createId('ticket') as TicketId
  const myBackOffice = createId('ticket') as TicketId
  await testDb.insert(tickets).values([
    { id: mine, title: 'Mine', statusId, type: 'customer', requesterPrincipalId: me },
    { id: theirs, title: 'Theirs', statusId, type: 'customer', requesterPrincipalId: other },
    {
      id: myBackOffice,
      title: 'Internal',
      statusId,
      type: 'back_office',
      requesterPrincipalId: me,
    },
  ])
  return { me, other, mine, theirs, myBackOffice }
}

describe.skipIf(!fixture.available)('requester ticket service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('listMyTickets returns only my customer tickets', async () => {
    const w = await seedWorld()
    const ids = (await listMyTickets(requesterActor(w.me))).map((d) => d.id)
    expect(ids).toContain(w.mine)
    expect(ids).not.toContain(w.theirs) // another requester's
    expect(ids).not.toContain(w.myBackOffice) // not a customer ticket
  })

  it("getMyTicket 404s another requester's ticket", async () => {
    const w = await seedWorld()
    await expect(getMyTicket(requesterActor(w.me), w.theirs)).rejects.toThrow(/not found/i)
  })

  it('getMyTicket 404s a non-customer ticket even when I am the requester', async () => {
    const w = await seedWorld()
    await expect(getMyTicket(requesterActor(w.me), w.myBackOffice)).rejects.toThrow(/not found/i)
  })

  it('getMyTicketThread strips internal notes', async () => {
    const w = await seedWorld()
    const agent = agentActor(w.other)
    await sendTicketMessage(agent, { ticketId: w.mine, content: 'public reply' })
    await addTicketNote(agent, { ticketId: w.mine, content: 'internal note' })
    const page = await getMyTicketThread(requesterActor(w.me), w.mine)
    expect(page.messages.map((m) => m.content)).toEqual(['public reply'])
  })

  it('replyToMyTicket posts a visitor message on my ticket', async () => {
    const w = await seedWorld()
    const { message } = await replyToMyTicket(requesterActor(w.me), {
      ticketId: w.mine,
      content: 'thanks!',
    })
    expect(message.senderType).toBe('visitor')
    expect(message.ticketId).toBe(w.mine)
  })

  it("replyToMyTicket 404s another requester's ticket", async () => {
    const w = await seedWorld()
    await expect(
      replyToMyTicket(requesterActor(w.me), { ticketId: w.theirs, content: 'sneaky' })
    ).rejects.toThrow(/not found/i)
  })
})
