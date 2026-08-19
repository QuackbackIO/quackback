/**
 * Real-DB coverage for the converged-Messages linked-ticket reads: the thread
 * header's `getRequesterTicketForConversation` and the list decoration's
 * `getRequesterTicketSummaries`. Both are scoped by the pair link AND
 * requester ownership — a pair whose ticket belongs to someone else must
 * never surface. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
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
  conversations,
  ticketConversations,
  tickets,
  ticketStatuses,
  principal,
  user,
  settings,
} from '@/lib/server/db'
import {
  getRequesterTicketForConversation,
  getRequesterTicketSummaries,
} from '../requester.service'

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

async function seedStatus(input: {
  category: 'open' | 'pending' | 'closed'
  publicStage: 'received' | 'in_progress' | 'awaiting_requester' | 'resolved' | null
}): Promise<TicketStatusId> {
  const [row] = await testDb
    .insert(ticketStatuses)
    .values({
      name: `S-${suffix()}`,
      slug: `s_${suffix()}`,
      category: input.category,
      publicStage: input.publicStage,
    })
    .returning({ id: ticketStatuses.id })
  return row.id
}

async function seedPair(input: {
  requester: PrincipalId
  statusId: TicketStatusId
  title?: string
}): Promise<{ conversationId: ConversationId; ticketId: TicketId }> {
  const conversationId = createId('conversation') as ConversationId
  const ticketId = createId('ticket') as TicketId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: input.requester, channel: 'messenger' })
  await testDb.insert(tickets).values({
    id: ticketId,
    title: input.title ?? 'Pair ticket',
    statusId: input.statusId,
    type: 'customer',
    requesterPrincipalId: input.requester,
  })
  await testDb
    .insert(ticketConversations)
    .values({ ticketId, conversationId, ticketType: 'customer' })
  return { conversationId, ticketId }
}

describe.skipIf(!fixture.available)(
  'linked-ticket reads for the converged Messages surface',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    async function seedWorld() {
      await testDb
        .insert(settings)
        .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
      return seedPrincipal()
    }

    it('returns the requester-audience DTO for an owned pair', async () => {
      const me = await seedWorld()
      const statusId = await seedStatus({ category: 'open', publicStage: 'in_progress' })
      const pair = await seedPair({ requester: me, statusId, title: 'Export bug' })

      const dto = await getRequesterTicketForConversation(pair.conversationId, me)
      expect(dto).not.toBeNull()
      expect(dto!.id).toBe(pair.ticketId)
      expect(dto!.title).toBe('Export bug')
      expect(dto!.stage.slot).toBe('in_progress')
      // Requester audience: internal status + SLA are stripped.
      expect(dto!.status).toBeNull()
      expect(dto!.sla).toBeNull()
    })

    it('returns null for a pair owned by someone else, an unlinked conversation, and a deleted ticket', async () => {
      const me = await seedWorld()
      const other = await seedPrincipal()
      const statusId = await seedStatus({ category: 'open', publicStage: 'received' })

      const theirs = await seedPair({ requester: other, statusId })
      expect(await getRequesterTicketForConversation(theirs.conversationId, me)).toBeNull()

      const bareConversation = createId('conversation') as ConversationId
      await testDb
        .insert(conversations)
        .values({ id: bareConversation, visitorPrincipalId: me, channel: 'messenger' })
      expect(await getRequesterTicketForConversation(bareConversation, me)).toBeNull()

      const mine = await seedPair({ requester: me, statusId })
      await testDb.update(tickets).set({ deletedAt: new Date() })
      expect(await getRequesterTicketForConversation(mine.conversationId, me)).toBeNull()
    })

    it('batches summaries keyed by conversation, with the B22 generic-close projection', async () => {
      const me = await seedWorld()
      const other = await seedPrincipal()
      const open = await seedStatus({ category: 'open', publicStage: 'in_progress' })
      // A null-stage closed status ("Won't do"): slot/label null, closed true.
      const nullStageClosed = await seedStatus({ category: 'closed', publicStage: null })

      const a = await seedPair({ requester: me, statusId: open, title: 'A' })
      const b = await seedPair({ requester: me, statusId: nullStageClosed, title: 'B' })
      const theirs = await seedPair({ requester: other, statusId: open })
      const bare = createId('conversation') as ConversationId
      await testDb
        .insert(conversations)
        .values({ id: bare, visitorPrincipalId: me, channel: 'messenger' })

      const map = await getRequesterTicketSummaries(
        [a.conversationId, b.conversationId, theirs.conversationId, bare],
        me
      )
      expect(map.size).toBe(2)

      const aSummary = map.get(a.conversationId)!
      expect(aSummary.ticketId).toBe(a.ticketId)
      expect(aSummary.stage.slot).toBe('in_progress')
      expect(aSummary.stage.closed).toBe(false)
      expect(aSummary.reference).toMatch(/^#\d+$/)

      const bSummary = map.get(b.conversationId)!
      expect(bSummary.stage.slot).toBeNull()
      expect(bSummary.stage.label).toBeNull()
      expect(bSummary.stage.closed).toBe(true)

      expect(map.has(theirs.conversationId)).toBe(false)
      expect(map.has(bare)).toBe(false)
    })

    it('returns an empty map for an empty input without querying', async () => {
      const me = await seedWorld()
      expect((await getRequesterTicketSummaries([], me)).size).toBe(0)
    })
  }
)
