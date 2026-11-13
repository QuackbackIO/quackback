/**
 * Real-Postgres proof of the inbox's ticket due date on the CONVERSATION list.
 * A customer ticket lists as its linked conversation's row (the one-row rule),
 * so the Due date filter and the 'due' sort reach through the
 * `ticket_conversations` pair edge to the linked live customer ticket:
 * overdue/due-soon/none match on that ticket, a resolved or soft-deleted ticket
 * never counts as overdue, and the sort ascends with undated rows last while
 * the keyset cursor pages across the NULL boundary without dupes or gaps.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type UserId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  principal,
  tickets,
  ticketConversations,
  ticketStatuses,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listConversationsForAgent } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})

const serviceActor: Actor = {
  principalId: null,
  role: null,
  principalType: 'service',
  segmentIds: new Set(),
}

const HOUR = 60 * 60 * 1000
const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

let visitorId: PrincipalId

async function seedVisitor() {
  const userId = createId('user') as UserId
  visitorId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: visitorId, userId, role: 'user', type: 'user', createdAt: new Date() })
}

async function seedStatus() {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Due-Open', slug: `due_open_${suffix()}`, category: 'open', position: 200 })
    .returning()
  return status.id
}

/** A conversation, optionally linked to a customer ticket with these fields. */
async function seedConversation(
  statusId: Awaited<ReturnType<typeof seedStatus>>,
  ticket?: { dueAt: Date | null; resolvedAt?: Date; deletedAt?: Date }
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId: visitorId, channel: 'messenger' })
  if (ticket) {
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      type: 'customer',
      title: 'Linked',
      statusId,
      dueAt: ticket.dueAt,
      resolvedAt: ticket.resolvedAt ?? null,
      deletedAt: ticket.deletedAt ?? null,
    })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId: id, ticketType: 'customer' })
  }
  return id
}

async function seedFixtures() {
  await seedVisitor()
  const statusId = await seedStatus()
  const now = Date.now()
  const resolved = await seedConversation(statusId, {
    dueAt: new Date(now - 3 * HOUR),
    resolvedAt: new Date(now - HOUR),
  })
  const overdue = await seedConversation(statusId, { dueAt: new Date(now - 2 * HOUR) })
  const soon = await seedConversation(statusId, { dueAt: new Date(now + 2 * HOUR) })
  const later = await seedConversation(statusId, { dueAt: new Date(now + 72 * HOUR) })
  const noDue = await seedConversation(statusId, { dueAt: null })
  const deleted = await seedConversation(statusId, {
    dueAt: new Date(now - HOUR),
    deletedAt: new Date(now - HOUR),
  })
  const unlinked = await seedConversation(statusId)
  return { resolved, overdue, soon, later, noDue, deleted, unlinked }
}

async function ids(filter: Parameters<typeof listConversationsForAgent>[0]) {
  const page = await listConversationsForAgent(
    { visitorPrincipalId: visitorId, ...filter },
    serviceActor
  )
  return page.conversations.map((c) => c.id)
}

describe.skipIf(!fixture.available)('conversation list: linked ticket due date', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('filters overdue through the linked live, unresolved customer ticket', async () => {
    const c = await seedFixtures()
    expect(await ids({ linkedTicketDue: 'overdue' })).toEqual([c.overdue])
  })

  it('filters due within 24 hours', async () => {
    const c = await seedFixtures()
    expect(await ids({ linkedTicketDue: 'due_soon' })).toEqual([c.soon])
  })

  it('filters a linked ticket with no due date (an unlinked conversation has no ticket)', async () => {
    const c = await seedFixtures()
    expect(await ids({ linkedTicketDue: 'none' })).toEqual([c.noDue])
  })

  it('does not constrain the list when the filter is unset', async () => {
    const c = await seedFixtures()
    expect(new Set(await ids({}))).toEqual(new Set(Object.values(c)))
  })

  it("sorts by the linked ticket's due date, ascending, undated rows last by id", async () => {
    const c = await seedFixtures()
    const undated = [c.noDue, c.deleted, c.unlinked].sort()
    expect(await ids({ sort: 'due' })).toEqual([c.resolved, c.overdue, c.soon, c.later, ...undated])
  })

  it('pages the due sort across the NULL boundary without dupes or gaps', async () => {
    const c = await seedFixtures()
    const full = await ids({ sort: 'due' })
    expect(full).toHaveLength(Object.keys(c).length)

    const paged: string[] = []
    let before: string | undefined
    for (let i = 0; i < 10; i++) {
      const page = await listConversationsForAgent(
        { visitorPrincipalId: visitorId, sort: 'due', limit: 2, before },
        serviceActor
      )
      paged.push(...page.conversations.map((row) => row.id))
      if (!page.hasMore) break
      before = page.nextCursor ?? undefined
    }
    expect(paged).toEqual(full)
  })

  it('combines the filter with the due sort', async () => {
    const c = await seedFixtures()
    const later = await ids({ sort: 'due', linkedTicketDue: 'due_soon' })
    expect(later).toEqual([c.soon])
  })
})
