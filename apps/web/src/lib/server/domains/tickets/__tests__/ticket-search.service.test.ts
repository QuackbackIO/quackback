/**
 * Real-DB coverage for searchTickets (§4.2 "one primitive, every surface"): FTS
 * over the title + message search_vector, audience scoping (agent via ticketFilter
 * vs requester own-customer), the internal-note strip for requesters, and the
 * <mark> snippet. Runs inside the db-test-fixture rollback transaction.
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

// Neutralize the real Redis-backed realtime publish (unified inbox §3.2, M3):
// seedWorld posts messages via sendTicketMessage/addTicketNote, which now
// fire it too; this suite isn't exercising that behavior.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))

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
import { searchTickets } from '../ticket-search.service'
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

/** An agent who sees all tickets (view_all) + can post messages, for seeding. */
function agentActor(principalId: PrincipalId): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
    ]),
  }
}

async function seedWorld() {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
  const me = await seedPrincipal()
  const other = await seedPrincipal()
  const agentP = await seedPrincipal()
  const agent = agentActor(agentP)
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `s_${suffix()}` })

  const mineTitled = createId('ticket') as TicketId // title match
  const mineMsg = createId('ticket') as TicketId // message match
  const theirs = createId('ticket') as TicketId // another requester's
  const myInternal = createId('ticket') as TicketId // back_office
  await testDb.insert(tickets).values([
    {
      id: mineTitled,
      title: 'Payment declined',
      statusId,
      type: 'customer',
      requesterPrincipalId: me,
    },
    {
      id: mineMsg,
      title: 'General question',
      statusId,
      type: 'customer',
      requesterPrincipalId: me,
    },
    {
      id: theirs,
      title: 'Payment refund',
      statusId,
      type: 'customer',
      requesterPrincipalId: other,
    },
    {
      id: myInternal,
      title: 'Payment reconciliation',
      statusId,
      type: 'back_office',
      requesterPrincipalId: me,
    },
  ])
  // A customer-visible message + an internal note on mineMsg.
  await sendTicketMessage(agent, { ticketId: mineMsg, content: 'the checkout page kept spinning' })
  await addTicketNote(agent, { ticketId: mineMsg, content: 'escalate to billing internally' })

  return { me, other, agent, mineTitled, mineMsg, theirs, myInternal }
}

describe.skipIf(!fixture.available)('searchTickets (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('an agent finds tickets by title across all types', async () => {
    const w = await seedWorld()
    const ids = (await searchTickets(w.agent, { query: 'payment', audience: 'agent' })).map(
      (r) => r.ticket.id
    )
    expect(ids).toContain(w.mineTitled)
    expect(ids).toContain(w.theirs) // agents see other requesters' tickets
    expect(ids).toContain(w.myInternal) // and back-office tickets
  })

  it('finds a ticket by a message-content match', async () => {
    const w = await seedWorld()
    const ids = (await searchTickets(w.agent, { query: 'checkout', audience: 'agent' })).map(
      (r) => r.ticket.id
    )
    expect(ids).toContain(w.mineMsg)
  })

  it('a requester only searches their own customer tickets', async () => {
    const w = await seedWorld()
    const ids = (
      await searchTickets(requesterActor(w.me), { query: 'payment', audience: 'requester' })
    ).map((r) => r.ticket.id)
    expect(ids).toContain(w.mineTitled)
    expect(ids).not.toContain(w.theirs) // another requester's
    expect(ids).not.toContain(w.myInternal) // not a customer ticket
  })

  it('a requester never matches on internal notes', async () => {
    const w = await seedWorld()
    const ids = (
      await searchTickets(requesterActor(w.me), { query: 'internally', audience: 'requester' })
    ).map((r) => r.ticket.id)
    expect(ids).not.toContain(w.mineMsg) // the match was an internal note
  })

  it('returns a highlighted snippet', async () => {
    const w = await seedWorld()
    const [top] = await searchTickets(w.agent, { query: 'checkout', audience: 'agent' })
    expect(top.snippet).toMatch(/<mark>/)
  })

  it('an empty query returns nothing', async () => {
    const w = await seedWorld()
    expect(await searchTickets(w.agent, { query: '   ', audience: 'agent' })).toEqual([])
  })
})
