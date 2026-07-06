/**
 * Real-DB coverage for the ticket unread-receipt service (unified inbox §3.3).
 * Runs inside the db-test-fixture rollback transaction; the global `db` is
 * mocked to the fixture transaction so the service writes land in the
 * rolled-back tx. Mirrors conversation.query.ts's unreadCountFor / the batched
 * list-unread query, and conversation.service.ts's markConversationRead, but
 * against tickets + conversation_messages WHERE ticket_id = X.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
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
import { tickets, ticketStatuses, conversationMessages, principal, user, eq } from '@/lib/server/db'
import {
  unreadCountForTicket,
  ticketUnreadMapForAgent,
  markTicketReadForAgent,
  markTicketReadForRequester,
} from '../ticket-unread.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTicket(): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `tu-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: 'T', statusId })
  return ticketId
}

async function seedAgentPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const agentP = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `A-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: agentP, userId, role: 'member', type: 'user', createdAt: new Date() })
  return agentP
}

async function insertMessage(opts: {
  ticketId: TicketId
  senderType: 'agent' | 'visitor' | 'system'
  isInternal?: boolean
  principalId?: PrincipalId | null
  createdAt?: Date
}) {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      ticketId: opts.ticketId,
      principalId: opts.principalId ?? null,
      senderType: opts.senderType,
      content: 'hi',
      isInternal: opts.isInternal ?? false,
      createdAt: opts.createdAt,
    })
    .returning()
  return row
}

async function ticketReadWatermarks(
  ticketId: TicketId
): Promise<{ requesterLastReadAt: Date | null; assigneeLastReadAt: Date | null }> {
  const [row] = await testDb
    .select({
      requesterLastReadAt: tickets.requesterLastReadAt,
      assigneeLastReadAt: tickets.assigneeLastReadAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row
}

describe.skipIf(!fixture.available)('ticket unread service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('unreadCountForTicket', () => {
    it('counts agent messages for the requester side with a null watermark (count all)', async () => {
      const ticketId = await seedTicket()
      const agentP = await seedAgentPrincipal()
      await insertMessage({ ticketId, senderType: 'agent', principalId: agentP })
      await insertMessage({ ticketId, senderType: 'agent', principalId: agentP })

      expect(await unreadCountForTicket(ticketId, 'requester')).toBe(2)
    })

    it('counts visitor messages for the assignee side with a null watermark (count all)', async () => {
      const ticketId = await seedTicket()
      await insertMessage({ ticketId, senderType: 'visitor' })
      await insertMessage({ ticketId, senderType: 'visitor' })
      await insertMessage({ ticketId, senderType: 'visitor' })

      expect(await unreadCountForTicket(ticketId, 'assignee')).toBe(3)
    })

    it('only counts messages newer than the watermark', async () => {
      const ticketId = await seedTicket()
      const old = new Date(Date.now() - 60_000)
      await insertMessage({ ticketId, senderType: 'visitor', createdAt: old })
      await testDb
        .update(tickets)
        .set({ assigneeLastReadAt: new Date(Date.now() - 30_000) })
        .where(eq(tickets.id, ticketId))
      await insertMessage({ ticketId, senderType: 'visitor' })

      expect(await unreadCountForTicket(ticketId, 'assignee')).toBe(1)
    })

    it('excludes internal notes and soft-deleted messages', async () => {
      const ticketId = await seedTicket()
      const agentP = await seedAgentPrincipal()
      await insertMessage({ ticketId, senderType: 'agent', principalId: agentP, isInternal: true })
      const deleted = await insertMessage({ ticketId, senderType: 'agent', principalId: agentP })
      await testDb
        .update(conversationMessages)
        .set({ deletedAt: new Date() })
        .where(eq(conversationMessages.id, deleted.id))

      expect(await unreadCountForTicket(ticketId, 'requester')).toBe(0)
    })

    it('never counts the other ticket parent kind (conversation-scoped messages)', async () => {
      // Regression guard for the polymorphic conversation_messages table
      // (§3.3): a ticket's unread count must only ever look at ticket_id = X.
      const ticketId = await seedTicket()
      const other = await seedTicket()
      await insertMessage({ ticketId: other, senderType: 'visitor' })

      expect(await unreadCountForTicket(ticketId, 'assignee')).toBe(0)
    })
  })

  describe('ticketUnreadMapForAgent', () => {
    it('returns a batched map of requester-authored unread counts keyed by ticket id', async () => {
      const ticketA = await seedTicket()
      const ticketB = await seedTicket()
      await insertMessage({ ticketId: ticketA, senderType: 'visitor' })
      await insertMessage({ ticketId: ticketA, senderType: 'visitor' })
      await insertMessage({ ticketId: ticketB, senderType: 'visitor' })

      const map = await ticketUnreadMapForAgent([ticketA, ticketB])
      expect(map.get(ticketA)).toBe(2)
      expect(map.get(ticketB)).toBe(1)
    })

    it('omits a ticket with zero unread messages from the map', async () => {
      const ticketId = await seedTicket()
      const agentP = await seedAgentPrincipal()
      await insertMessage({ ticketId, senderType: 'agent', principalId: agentP })

      const map = await ticketUnreadMapForAgent([ticketId])
      expect(map.get(ticketId)).toBeUndefined()
    })

    it('respects each ticket assignee_last_read_at watermark independently', async () => {
      const ticketA = await seedTicket()
      const ticketB = await seedTicket()
      await testDb
        .update(tickets)
        .set({ assigneeLastReadAt: new Date() })
        .where(eq(tickets.id, ticketA))
      await insertMessage({
        ticketId: ticketA,
        senderType: 'visitor',
        createdAt: new Date(Date.now() - 60_000),
      })
      await insertMessage({ ticketId: ticketB, senderType: 'visitor' })

      const map = await ticketUnreadMapForAgent([ticketA, ticketB])
      expect(map.get(ticketA)).toBeUndefined()
      expect(map.get(ticketB)).toBe(1)
    })
  })

  describe('markTicketReadForAgent / markTicketReadForRequester', () => {
    it('sets assignee_last_read_at to now by default', async () => {
      const ticketId = await seedTicket()
      const before = await ticketReadWatermarks(ticketId)
      expect(before.assigneeLastReadAt).toBeNull()

      await markTicketReadForAgent(ticketId)

      const after = await ticketReadWatermarks(ticketId)
      expect(after.assigneeLastReadAt).not.toBeNull()
      expect(after.requesterLastReadAt).toBeNull()
    })

    it('sets requester_last_read_at to now by default', async () => {
      const ticketId = await seedTicket()

      await markTicketReadForRequester(ticketId)

      const after = await ticketReadWatermarks(ticketId)
      expect(after.requesterLastReadAt).not.toBeNull()
      expect(after.assigneeLastReadAt).toBeNull()
    })

    it('accepts an explicit `at` timestamp instead of defaulting to now', async () => {
      const ticketId = await seedTicket()
      const at = new Date('2026-01-01T00:00:00.000Z')

      await markTicketReadForAgent(ticketId, at)

      const after = await ticketReadWatermarks(ticketId)
      expect(after.assigneeLastReadAt?.toISOString()).toBe(at.toISOString())
    })

    it('marking read clears the unread count for that side', async () => {
      const ticketId = await seedTicket()
      await insertMessage({ ticketId, senderType: 'visitor' })
      expect(await unreadCountForTicket(ticketId, 'assignee')).toBe(1)

      await markTicketReadForAgent(ticketId)

      expect(await unreadCountForTicket(ticketId, 'assignee')).toBe(0)
    })
  })
})
