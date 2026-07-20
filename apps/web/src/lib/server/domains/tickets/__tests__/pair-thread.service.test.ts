/**
 * Real-DB coverage for the convergence Phase 0 pair-thread union loader
 * (scratchpad/convergence-design.md, mechanics appendix "Read (Phase 0)"):
 * the 1:1 pair resolution, the merged (created_at, id) ordering across both
 * parents with the `source` provenance hint, keyset pagination through the
 * union via a single message-id cursor (both page orders: the DESC keyset
 * walk and the oldest-first `all` read), the audience rule (internal notes
 * stripped on BOTH parents — the guarantee summaries and public grounding
 * rely on), and the degenerate cases (standalone ticket, back-office ticket,
 * stray non-customer link row). Runs inside the db-test-fixture rollback tx.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// config getters validate the full env (absent in tests); mirror
// ticket-message.service.test.ts's minimal stub (author avatar resolution
// reads it through loadAuthors -> getPublicUrlOrNull).
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  principal,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import { listPairThreadMessages, resolvePairConversationId } from '../pair-thread.service'
import { listTicketMessages } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Deterministic message timestamps within a test (1 minute apart). */
function seedClock(start = '2026-07-01T00:00:00Z') {
  let t = Date.parse(start)
  return () => new Date((t += 60_000))
}

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedTicket(type: 'customer' | 'back_office' = 'customer'): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `pt_${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: `T-${suffix()}`, statusId, type })
  return ticketId
}

async function seedConversation(): Promise<ConversationId> {
  const visitorPrincipalId = await seedPrincipal()
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })
  return conversationId
}

async function linkPair(
  ticketId: TicketId,
  conversationId: ConversationId,
  ticketType: 'customer' | 'back_office' = 'customer'
): Promise<void> {
  await testDb.insert(ticketConversations).values({ ticketId, conversationId, ticketType })
}

/** Insert a message on one parent of the pair; the id is DB-generated. */
async function post(
  parent: { ticketId: TicketId } | { conversationId: ConversationId },
  content: string,
  opts: { internal?: boolean; at: Date; author?: PrincipalId }
): Promise<ConversationMessageId> {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      ...('ticketId' in parent ? { ticketId: parent.ticketId } : {}),
      ...('conversationId' in parent ? { conversationId: parent.conversationId } : {}),
      principalId: opts.author ?? null,
      senderType: opts.author ? 'agent' : 'system',
      content,
      isInternal: opts.internal ?? false,
      createdAt: opts.at,
    })
    .returning({ id: conversationMessages.id })
  return row.id
}

describe.skipIf(!fixture.available)('pair-thread union loader (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('resolves the pair only for a CUSTOMER-ticket link (1:1, 0214)', async () => {
    const standalone = await seedTicket()
    expect(await resolvePairConversationId(standalone)).toBeNull()

    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)
    expect(await resolvePairConversationId(ticketId)).toBe(conversationId)

    // A stray non-customer link row never creates a pair: back-office/tracker
    // tickets keep their own internal thread (the link service also rejects
    // them — this is the read-side defense of the same invariant).
    const backOffice = await seedTicket('back_office')
    const otherConversation = await seedConversation()
    await linkPair(backOffice, otherConversation, 'back_office')
    expect(await resolvePairConversationId(backOffice)).toBeNull()
  })

  it('merges both parents in (createdAt, id) order and tags each row with its source', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)

    // Strict interleave across the two parents.
    const m1 = await post({ ticketId }, 't1', { at: next(), author })
    const m2 = await post({ conversationId }, 'c1', { at: next(), author })
    const m3 = await post({ ticketId }, 't2', { at: next(), author })
    const m4 = await post({ conversationId }, 'c2', { at: next(), author })

    const page = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(page.hasMore).toBe(false)
    expect(page.messages.map((m) => m.id)).toEqual([m1, m2, m3, m4])
    expect(page.messages.map((m) => m.source)).toEqual([
      'ticket',
      'conversation',
      'ticket',
      'conversation',
    ])
    // The base DTO fields already discriminate the parent, consistently.
    expect(page.messages[0].ticketId).toBe(ticketId)
    expect(page.messages[1].conversationId).toBe(conversationId)
    // Authors resolve across parents in one batch.
    expect(page.messages.every((m) => m.author?.principalId === author)).toBe(true)
  })

  it('applies the audience rule to BOTH parents (internal notes never leak)', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)

    const visible1 = await post({ ticketId }, 'visible t', { at: next(), author })
    await post({ ticketId }, 'internal note on ticket', { at: next(), author, internal: true })
    const visible2 = await post({ conversationId }, 'visible c', { at: next(), author })
    await post({ conversationId }, 'internal note on conversation', {
      at: next(),
      author,
      internal: true,
    })

    const requesterView = await listPairThreadMessages(ticketId, { includeInternal: false })
    expect(requesterView.messages.map((m) => m.id)).toEqual([visible1, visible2])

    const agentView = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(agentView.messages).toHaveLength(4)

    // The exact callers summaries/grounding use: listTicketMessages with the
    // internal strip — excluded on both parents, on the paged AND the `all`
    // read (grounding's shape).
    const summaryShape = await listTicketMessages(ticketId, { includeInternal: false })
    expect(summaryShape.messages.map((m) => m.id)).toEqual([visible1, visible2])
    const groundingShape = await listTicketMessages(ticketId, { includeInternal: false, all: true })
    expect(groundingShape.messages.map((m) => m.id)).toEqual([visible1, visible2])
    const teamGrounding = await listTicketMessages(ticketId, { includeInternal: true, all: true })
    expect(teamGrounding.messages).toHaveLength(4)
  })

  it('keyset-paginates the merged thread with a single message-id cursor', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)

    // 70 messages strictly interleaved across the parents (page size is 30).
    const posted: ConversationMessageId[] = []
    for (let i = 0; i < 70; i++) {
      const parent = i % 2 === 0 ? { ticketId } : { conversationId }
      posted.push(await post(parent, `m${i}`, { at: next(), author }))
    }

    const page1 = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(page1.messages).toHaveLength(30)
    expect(page1.hasMore).toBe(true)
    // Newest-loaded page returned oldest-first: page 1 covers m40..m69.
    expect(page1.messages.map((m) => m.id)).toEqual(posted.slice(40))

    const page2 = await listPairThreadMessages(ticketId, {
      includeInternal: true,
      before: page1.messages[0].id,
    })
    expect(page2.messages.map((m) => m.id)).toEqual(posted.slice(10, 40))
    expect(page2.hasMore).toBe(true)

    const page3 = await listPairThreadMessages(ticketId, {
      includeInternal: true,
      before: page2.messages[0].id,
    })
    expect(page3.messages.map((m) => m.id)).toEqual(posted.slice(0, 10))
    expect(page3.hasMore).toBe(false)

    // No duplicates, no gaps, full coverage across the three pages.
    const walked = [...page3.messages, ...page2.messages, ...page1.messages].map((m) => m.id)
    expect(new Set(walked).size).toBe(70)
    expect(walked).toEqual(posted)
  })

  it('the `all` read returns the entire merged thread oldest-first', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)

    const posted: ConversationMessageId[] = []
    for (let i = 0; i < 5; i++) {
      const parent = i % 2 === 0 ? { ticketId } : { conversationId }
      posted.push(await post(parent, `m${i}`, { at: next(), author }))
    }

    const page = await listPairThreadMessages(ticketId, { includeInternal: true, all: true })
    expect(page.hasMore).toBe(false)
    expect(page.messages.map((m) => m.id)).toEqual(posted)
  })

  it('degenerates to the legacy ticket-only thread for a standalone ticket', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()

    const m1 = await post({ ticketId }, 'only', { at: next(), author })
    const m2 = await post({ ticketId }, 'thread', { at: next(), author })

    const page = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(page.hasMore).toBe(false)
    expect(page.messages.map((m) => m.id)).toEqual([m1, m2])
    expect(page.messages.every((m) => m.source === 'ticket')).toBe(true)

    // ...and the wired readers (listTicketMessages delegation) see the same.
    const delegated = await listTicketMessages(ticketId, { includeInternal: true })
    expect(delegated.messages.map((m) => m.id)).toEqual([m1, m2])
  })

  it('a back-office ticket keeps its own thread even with a stray link row', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket('back_office')
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId, 'back_office')

    const own = await post({ ticketId }, 'internal task note', { at: next(), author })
    await post({ conversationId }, 'conversation chatter', { at: next(), author })

    const page = await listPairThreadMessages(ticketId, { includeInternal: true })
    expect(page.messages.map((m) => m.id)).toEqual([own])
  })

  it('listTicketMessages (every wired ticket reader) returns the pair union', async () => {
    const next = seedClock()
    const author = await seedPrincipal()
    const ticketId = await seedTicket()
    const conversationId = await seedConversation()
    await linkPair(ticketId, conversationId)

    const m1 = await post({ ticketId }, 'legacy ticket reply', { at: next(), author })
    const m2 = await post({ conversationId }, 'conversation message', { at: next(), author })

    // This is the read the agent thread, portal, widget, summaries, grounding,
    // transcript export, MCP and API v1 all share after the Phase 0 wiring.
    const page = await listTicketMessages(ticketId, { includeInternal: true })
    expect(page.messages.map((m) => m.id)).toEqual([m1, m2])
  })
})
