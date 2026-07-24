/**
 * Real-DB coverage for convergence Phase 2 READ-THROUGH
 * (scratchpad/convergence-design.md — "the pair runs on the conversation's
 * two watermarks"; Intercom's "a ticket is marked as read when the linked
 * conversation is read"). Runs inside the db-test-fixture rollback
 * transaction. Covers:
 *
 *  - AGENT SIDE: `markTicketReadForAgent` on a linked customer pair writes the
 *    CONVERSATION's `agentLastReadAt` (via the conversation domain's own
 *    mark-read) and leaves the legacy `tickets.assignee_last_read_at` column
 *    untouched; a standalone ticket keeps the legacy write + `ticket_read`.
 *  (The requester-side wrappers and their list badge retired with the
 *  converged Messages surface: the requester reads their pair through the
 *  conversation surface directly, so conversation mark-read IS the requester
 *  truth with no ticket-side delegation left to characterize.)
 *
 * The conversation domain's mark-read runs for real (dynamic import — the
 * same delegation markTicketUnreadFromMessage's 1a fallback uses); realtime
 * is mocked so no Redis fan-out runs, and the publish is assertable.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// config getters validate the full env (absent in tests); mirror the sibling
// convergence suites' minimal stub.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the Redis-backed realtime fan-out on BOTH channels (the ticket
// channel the legacy path publishes on, the conversation channel the pair
// delegate publishes on).
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  principal,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  eq,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { markTicketReadForAgent } from '../ticket-unread.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'member' | 'user' = 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

function agentActor(principalId: PrincipalId, extra: PermissionKey[] = []): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    role: 'member',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.CONVERSATION_VIEW,
      PERMISSIONS.CONVERSATION_REPLY,
      ...extra,
    ]),
  }
}

async function seedTicket(opts: { requesterPrincipalId?: PrincipalId } = {}): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `p2_${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id: ticketId,
    title: `T-${suffix()}`,
    statusId,
    type: 'customer',
    requesterPrincipalId: opts.requesterPrincipalId ?? null,
  })
  return ticketId
}

async function seedConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })
  return conversationId
}

async function linkPair(ticketId: TicketId, conversationId: ConversationId): Promise<void> {
  await testDb
    .insert(ticketConversations)
    .values({ ticketId, conversationId, ticketType: 'customer' })
}

async function ticketWatermarks(
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

async function conversationWatermarks(
  conversationId: ConversationId
): Promise<{ visitorLastReadAt: Date | null; agentLastReadAt: Date | null }> {
  const [row] = await testDb
    .select({
      visitorLastReadAt: conversations.visitorLastReadAt,
      agentLastReadAt: conversations.agentLastReadAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row
}

describe.skipIf(!fixture.available)(
  'convergence Phase 2 read-through (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    beforeEach(() => {
      realtime.publishTicketEvent.mockClear()
      realtime.publishConversationEvent.mockClear()
    })
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    describe('markTicketReadForAgent', () => {
      it('a linked pair marks the CONVERSATION agent watermark, never the legacy ticket column', async () => {
        const agentP = await seedPrincipal()
        const visitorP = await seedPrincipal('user')
        const ticketId = await seedTicket({ requesterPrincipalId: visitorP })
        const conversationId = await seedConversation(visitorP)
        await linkPair(ticketId, conversationId)

        await markTicketReadForAgent(ticketId, agentActor(agentP))

        const conv = await conversationWatermarks(conversationId)
        expect(conv.agentLastReadAt).not.toBeNull()
        expect(conv.visitorLastReadAt).toBeNull()
        const ticket = await ticketWatermarks(ticketId)
        expect(ticket.assigneeLastReadAt).toBeNull()
        expect(ticket.requesterLastReadAt).toBeNull()
        // The conversation channel's read event fired (the pair lists as the
        // conversation row — that's the badge it clears); the legacy ticket
        // channel event did not.
        expect(realtime.publishConversationEvent).toHaveBeenCalledWith(conversationId, {
          kind: 'read',
          conversationId,
          side: 'agent',
          at: expect.any(String),
        })
        expect(realtime.publishTicketEvent).not.toHaveBeenCalled()
      })

      it('a standalone ticket keeps the legacy ticket-column write + ticket_read event', async () => {
        const agentP = await seedPrincipal()
        const ticketId = await seedTicket()

        await markTicketReadForAgent(ticketId, agentActor(agentP))

        const ticket = await ticketWatermarks(ticketId)
        expect(ticket.assigneeLastReadAt).not.toBeNull()
        expect(realtime.publishTicketEvent).toHaveBeenCalledWith(ticketId, {
          kind: 'ticket_read',
          ticketId,
          side: 'agent',
          at: expect.any(String),
        })
        expect(realtime.publishConversationEvent).not.toHaveBeenCalled()
      })
    })
  }
)
