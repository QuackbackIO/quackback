/**
 * Real-DB coverage for the conversation side of the convergence Phase 0 pair
 * thread (scratchpad/convergence-design.md): `listMessages` with
 * `includeLinkedTicket` folds a linked CUSTOMER ticket's legacy
 * ticket-parented rows into the agent conversation view — one shared thread
 * per pair, merged on the same (created_at, id) keyset contract as
 * pair-thread.service.ts's ticket-side loader. Covers the merged ordering,
 * the audience rule across both parents, keyset paging whose cursor anchor is
 * a TICKET-parented row (findPairCursor), and the degenerate no-link case.
 * Runs inside the db-test-fixture rollback tx.
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

// Same minimal config stub as the tickets-domain suites (author avatar
// resolution reads it through loadAuthors -> getPublicUrlOrNull).
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
import { listMessages } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

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

async function seedConversationWithLinkedTicket(): Promise<{
  conversationId: ConversationId
  ticketId: TicketId
}> {
  const visitorPrincipalId = await seedPrincipal()
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `cpt_${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb
    .insert(tickets)
    .values({ id: ticketId, title: `T-${suffix()}`, statusId, type: 'customer' })
  await testDb
    .insert(ticketConversations)
    .values({ ticketId, conversationId, ticketType: 'customer' })
  return { conversationId, ticketId }
}

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

describe.skipIf(!fixture.available)(
  'listMessages includeLinkedTicket — conversation view of a pair (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('renders the legacy ticket rows inline, merged in (createdAt, id) order', async () => {
      const next = seedClock()
      const author = await seedPrincipal()
      const { conversationId, ticketId } = await seedConversationWithLinkedTicket()

      const m1 = await post({ conversationId }, 'visitor opens', { at: next(), author })
      const m2 = await post({ ticketId }, 'legacy ticket reply', { at: next(), author })
      const m3 = await post({ conversationId }, 'agent reply', { at: next(), author })
      const m4 = await post({ ticketId }, 'legacy internal note', {
        at: next(),
        author,
        internal: true,
      })

      const page = await listMessages(conversationId, {
        includeInternal: true,
        includeLinkedTicket: true,
      })
      expect(page.hasMore).toBe(false)
      expect(page.messages.map((m) => m.id)).toEqual([m1, m2, m3, m4])
      // The DTO parent fields discriminate provenance for renderers.
      expect(page.messages[1].ticketId).toBe(ticketId)
      expect(page.messages[1].conversationId).toBeNull()
      expect(page.messages[3].isInternal).toBe(true)
    })

    it('is byte-identical to the legacy read when the flag is off', async () => {
      const next = seedClock()
      const author = await seedPrincipal()
      const { conversationId, ticketId } = await seedConversationWithLinkedTicket()

      const m1 = await post({ conversationId }, 'visitor opens', { at: next(), author })
      await post({ ticketId }, 'legacy ticket reply', { at: next(), author })
      const m3 = await post({ conversationId }, 'agent reply', { at: next(), author })

      const page = await listMessages(conversationId, { includeInternal: true })
      expect(page.messages.map((m) => m.id)).toEqual([m1, m3])
    })

    it('applies the audience rule to both parents when internal is stripped', async () => {
      const next = seedClock()
      const author = await seedPrincipal()
      const { conversationId, ticketId } = await seedConversationWithLinkedTicket()

      const visible1 = await post({ conversationId }, 'visible c', { at: next(), author })
      await post({ conversationId }, 'internal c', { at: next(), author, internal: true })
      const visible2 = await post({ ticketId }, 'visible t', { at: next(), author })
      await post({ ticketId }, 'internal t', { at: next(), author, internal: true })

      const page = await listMessages(conversationId, {
        includeInternal: false,
        includeLinkedTicket: true,
      })
      expect(page.messages.map((m) => m.id)).toEqual([visible1, visible2])
    })

    it('degenerates to the conversation-only thread when no ticket is linked', async () => {
      const next = seedClock()
      const author = await seedPrincipal()
      const visitorPrincipalId = await seedPrincipal()
      const conversationId = createId('conversation') as ConversationId
      await testDb
        .insert(conversations)
        .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })

      const m1 = await post({ conversationId }, 'one', { at: next(), author })
      const m2 = await post({ conversationId }, 'two', { at: next(), author })

      const page = await listMessages(conversationId, {
        includeInternal: true,
        includeLinkedTicket: true,
      })
      expect(page.hasMore).toBe(false)
      expect(page.messages.map((m) => m.id)).toEqual([m1, m2])
    })

    it('pages through the union when the cursor anchor is a TICKET-parented row', async () => {
      const next = seedClock()
      const author = await seedPrincipal()
      const { conversationId, ticketId } = await seedConversationWithLinkedTicket()

      // 35 messages, odd indices ticket-parented; page size is 30, so the
      // oldest row of page 1 is a legacy ticket row — the anchor the next
      // `before` must resolve unscoped (findPairCursor).
      const posted: ConversationMessageId[] = []
      for (let i = 0; i < 35; i++) {
        const parent = i % 2 === 1 ? { ticketId } : { conversationId }
        posted.push(await post(parent, `m${i}`, { at: next(), author }))
      }

      const page1 = await listMessages(conversationId, {
        includeInternal: true,
        includeLinkedTicket: true,
      })
      expect(page1.messages).toHaveLength(30)
      expect(page1.hasMore).toBe(true)
      expect(page1.messages.map((m) => m.id)).toEqual(posted.slice(5))
      const anchor = page1.messages[0]
      expect(anchor.ticketId).toBe(ticketId) // the anchor really is ticket-parented
      expect(page1.nextCursor).toBe(anchor.id)

      const page2 = await listMessages(conversationId, {
        includeInternal: true,
        includeLinkedTicket: true,
        before: anchor.id,
      })
      expect(page2.hasMore).toBe(false)
      expect(page2.messages.map((m) => m.id)).toEqual(posted.slice(0, 5))

      const walked = [...page2.messages, ...page1.messages].map((m) => m.id)
      expect(new Set(walked).size).toBe(35)
      expect(walked).toEqual(posted)
    })
  }
)
