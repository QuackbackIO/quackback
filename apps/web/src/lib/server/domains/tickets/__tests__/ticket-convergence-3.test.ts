/**
 * Real-DB coverage for convergence Phase 3 CLEANUP
 * (scratchpad/convergence-design.md — "customer-ticket watermarks to legacy,
 * collapse ticket-thread-only readers"). Runs inside the db-test-fixture
 * rollback transaction. Covers:
 *
 *  - WRITER CLEANUP (`markTicketUnreadFromMessage`): a LEGACY ticket-parented
 *    "mark unread from here" anchor on a linked customer pair moves the
 *    CONVERSATION's `agentLastReadAt` (the pair's watermark truth) and never
 *    writes the retired `tickets.assignee_last_read_at` column; a standalone
 *    ticket keeps the legacy write.
 *  - UNION ACTIVITY (`loadTicketActivity`, ticket.dto.ts): the DTO's
 *    `lastMessageAt`/`lastMessagePreview` reflect BOTH parents of a linked
 *    pair — the single-ticket path (`ticketRowToDTO`) and the batched list
 *    path (`buildTicketContext` + `ticketToDTO`) alike; a standalone ticket's
 *    read is unchanged.
 *  - ASSISTANT PRE-CHECK (`loadAssistantItemState`, assistant.thread.ts): a
 *    linked pair's staleness id is the UNION's newest visitor message (a
 *    conversation-parented requester reply), so the suggest route agrees with
 *    the union thread the client rendered.
 *
 * The conversation domain's mark-unread runs for real (dynamic import — the
 * same delegation the ticket-unread service uses); realtime is mocked so no
 * Redis fan-out runs, and the publishes are assertable.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
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

// config getters validate the full env (absent in tests); mirror the sibling
// convergence suites' minimal stub.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the Redis-backed realtime fan-out on BOTH channels (the ticket
// channel the legacy path publishes on, the conversation channels the pair
// delegates publish on).
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
  settings,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  eq,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { markTicketUnreadFromMessage } from '../ticket-unread.service'
import { buildTicketContext, ticketRowToDTO, ticketToDTO } from '../ticket.dto'
import { loadAssistantItemState } from '../../assistant/assistant.thread'

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
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `p3_${suffix()}` })
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

/** Insert a message on one parent, returning its id. */
async function post(
  parent: { ticketId: TicketId } | { conversationId: ConversationId },
  opts: {
    senderType: 'agent' | 'visitor'
    isInternal?: boolean
    content?: string
    createdAt?: Date
  }
): Promise<ConversationMessageId> {
  const id = createId('conversation_message') as ConversationMessageId
  await testDb.insert(conversationMessages).values({
    id,
    ...('ticketId' in parent ? { ticketId: parent.ticketId } : {}),
    ...('conversationId' in parent ? { conversationId: parent.conversationId } : {}),
    principalId: null,
    senderType: opts.senderType,
    content: opts.content ?? 'hi',
    isInternal: opts.isInternal ?? false,
    createdAt: opts.createdAt,
  })
  return id
}

async function loadTicketRow(ticketId: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, ticketId))
  return row
}

describe.skipIf(!fixture.available)('convergence Phase 3 cleanup (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    realtime.publishTicketEvent.mockClear()
    realtime.publishAgentConversationEvent.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('markTicketUnreadFromMessage (writer cleanup)', () => {
    it('a legacy ticket-parented anchor on a linked pair moves the CONVERSATION agent watermark, never the ticket column', async () => {
      const agentP = await seedPrincipal()
      const visitorP = await seedPrincipal('user')
      const ticketId = await seedTicket({ requesterPrincipalId: visitorP })
      const conversationId = await seedConversation(visitorP)
      await linkPair(ticketId, conversationId)

      // A legacy ticket-parented row (written pre-convergence, never
      // migrated) is the anchor; the pair's agent watermark sits AFTER it.
      const anchorCreatedAt = new Date(Date.now() - 60_000)
      const anchorId = await post(
        { ticketId },
        { senderType: 'visitor', createdAt: anchorCreatedAt }
      )
      await testDb
        .update(conversations)
        .set({ agentLastReadAt: new Date() })
        .where(eq(conversations.id, conversationId))

      await markTicketUnreadFromMessage(ticketId, anchorId, agentActor(agentP))

      // The retired ticket column is never written…
      const [ticket] = await testDb
        .select({ assigneeLastReadAt: tickets.assigneeLastReadAt })
        .from(tickets)
        .where(eq(tickets.id, ticketId))
      expect(ticket.assigneeLastReadAt).toBeNull()
      // …the CONVERSATION's agent watermark rewound to just before the anchor…
      const [conversation] = await testDb
        .select({ agentLastReadAt: conversations.agentLastReadAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      const expected = new Date(anchorCreatedAt.getTime() - 1)
      expect(conversation.agentLastReadAt?.toISOString()).toBe(expected.toISOString())
      // …and the read event went out on the agent conversation channel, not
      // the ticket channel.
      expect(realtime.publishAgentConversationEvent).toHaveBeenCalledWith({
        kind: 'read',
        conversationId,
        side: 'agent',
        at: expected.toISOString(),
      })
      expect(realtime.publishTicketEvent).not.toHaveBeenCalled()
    })

    it('a standalone customer ticket keeps the legacy ticket-column write', async () => {
      const agentP = await seedPrincipal()
      const ticketId = await seedTicket()
      const anchorCreatedAt = new Date(Date.now() - 60_000)
      const anchorId = await post(
        { ticketId },
        { senderType: 'visitor', createdAt: anchorCreatedAt }
      )
      await testDb
        .update(tickets)
        .set({ assigneeLastReadAt: new Date() })
        .where(eq(tickets.id, ticketId))

      await markTicketUnreadFromMessage(ticketId, anchorId, agentActor(agentP))

      const [ticket] = await testDb
        .select({ assigneeLastReadAt: tickets.assigneeLastReadAt })
        .from(tickets)
        .where(eq(tickets.id, ticketId))
      const expected = new Date(anchorCreatedAt.getTime() - 1)
      expect(ticket.assigneeLastReadAt?.toISOString()).toBe(expected.toISOString())
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(ticketId, {
        kind: 'ticket_read',
        ticketId,
        side: 'agent',
        at: expected.toISOString(),
      })
    })
  })

  describe('loadTicketActivity (union DTO activity)', () => {
    async function seedSettingsRow(): Promise<void> {
      await testDb
        .insert(settings)
        .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
    }

    it('single-ticket path (ticketRowToDTO): lastMessageAt/preview read the union of both parents', async () => {
      await seedSettingsRow()
      const visitorP = await seedPrincipal('user')
      const ticketId = await seedTicket({ requesterPrincipalId: visitorP })
      const conversationId = await seedConversation(visitorP)
      await linkPair(ticketId, conversationId)

      // Legacy ticket-parented visible row (older) — the pre-convergence
      // thread…
      await post(
        { ticketId },
        {
          senderType: 'visitor',
          content: 'legacy customer message',
          createdAt: new Date(Date.now() - 60_000),
        }
      )
      // …the pair's newest CUSTOMER-VISIBLE row, conversation-parented
      // (post-1a agent replies land there)…
      const latestVisibleAt = new Date(Date.now() - 10_000)
      await post(
        { conversationId },
        {
          senderType: 'agent',
          content: 'Latest visible from the conversation',
          createdAt: latestVisibleAt,
        }
      )
      // …and an internal note on the ticket parent, newest of ANY kind —
      // notes still count as activity but never as the preview.
      const noteAt = new Date(Date.now() - 5_000)
      await post(
        { ticketId },
        { senderType: 'agent', isInternal: true, content: 'internal note', createdAt: noteAt }
      )

      const dto = await ticketRowToDTO(await loadTicketRow(ticketId))
      expect(dto.lastMessageAt).toBe(noteAt.toISOString())
      expect(dto.lastMessagePreview).toBe('Latest visible from the conversation')
    })

    it('batch path (buildTicketContext): linked and standalone tickets each read their own truth', async () => {
      await seedSettingsRow()
      const visitorP = await seedPrincipal('user')
      const linkedId = await seedTicket({ requesterPrincipalId: visitorP })
      const conversationId = await seedConversation(visitorP)
      await linkPair(linkedId, conversationId)
      const standaloneId = await seedTicket({ requesterPrincipalId: visitorP })

      // Linked pair: the newest activity is conversation-parented.
      const pairLatestAt = new Date(Date.now() - 10_000)
      await post(
        { ticketId: linkedId },
        {
          senderType: 'visitor',
          content: 'pair legacy message',
          createdAt: new Date(Date.now() - 60_000),
        }
      )
      await post(
        { conversationId },
        { senderType: 'agent', content: 'pair preview', createdAt: pairLatestAt }
      )
      // Standalone: the legacy ticket-parented read, untouched by the union.
      const standaloneLatestAt = new Date(Date.now() - 20_000)
      await post(
        { ticketId: standaloneId },
        { senderType: 'agent', content: 'standalone preview', createdAt: standaloneLatestAt }
      )

      const rows = [await loadTicketRow(linkedId), await loadTicketRow(standaloneId)]
      const ctx = await buildTicketContext(rows)
      const linkedDto = ticketToDTO(rows[0], ctx)
      const standaloneDto = ticketToDTO(rows[1], ctx)

      expect(linkedDto.lastMessageAt).toBe(pairLatestAt.toISOString())
      expect(linkedDto.lastMessagePreview).toBe('pair preview')
      expect(standaloneDto.lastMessageAt).toBe(standaloneLatestAt.toISOString())
      expect(standaloneDto.lastMessagePreview).toBe('standalone preview')
    })

    it('a linked pair falls back to ticket-parented activity when the conversation side is quiet', async () => {
      await seedSettingsRow()
      const visitorP = await seedPrincipal('user')
      const ticketId = await seedTicket({ requesterPrincipalId: visitorP })
      const conversationId = await seedConversation(visitorP)
      await linkPair(ticketId, conversationId)

      const legacyAt = new Date(Date.now() - 30_000)
      await post(
        { ticketId },
        { senderType: 'visitor', content: 'only legacy activity', createdAt: legacyAt }
      )

      const dto = await ticketRowToDTO(await loadTicketRow(ticketId))
      expect(dto.lastMessageAt).toBe(legacyAt.toISOString())
      expect(dto.lastMessagePreview).toBe('only legacy activity')
    })
  })

  describe('loadAssistantItemState (union staleness pre-check)', () => {
    it("a linked pair's latestCustomerMessageId is the union's newest visitor message", async () => {
      const visitorP = await seedPrincipal('user')
      const ticketId = await seedTicket({ requesterPrincipalId: visitorP })
      const conversationId = await seedConversation(visitorP)
      await linkPair(ticketId, conversationId)

      // Legacy ticket-parented visitor row (older)…
      await post({ ticketId }, { senderType: 'visitor', createdAt: new Date(Date.now() - 60_000) })
      // …the requester's latest reply, conversation-parented (post-1a).
      const newestId = await post(
        { conversationId },
        { senderType: 'visitor', createdAt: new Date(Date.now() - 10_000) }
      )

      const state = await loadAssistantItemState(null, ticketId)
      expect(state?.closed).toBe(false)
      expect(state?.latestCustomerMessageId).toBe(newestId)
    })

    it('a standalone ticket still reads its own ticket-parented thread', async () => {
      const ticketId = await seedTicket()
      const newestId = await post({ ticketId }, { senderType: 'visitor' })

      const state = await loadAssistantItemState(null, ticketId)
      expect(state?.latestCustomerMessageId).toBe(newestId)
    })
  })
})
