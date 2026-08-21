/**
 * Real-DB coverage for carrying a back-office ticket's internal notes across
 * its provenance links (ticket-conversation-link.service's provenance rule).
 * Runs inside the db-test-fixture rollback transaction.
 *
 * The rule under test: a ticket opened FROM a conversation keeps that
 * conversation, and the work recorded on it can be sent back — a note the
 * author SHARES lands on the conversation as an internal note of its own, so
 * the teammate reading the customer thread sees what happened to the task spun
 * off it.
 *
 * Four edges:
 *  - TICKET-ONLY IS THE DEFAULT. A note carries nowhere unless its author asks
 *    it to. A back-office thread is mostly the specialist's own working
 *    chatter, and none of that belongs on the customer's conversation.
 *  - LOOP SAFETY. Every carried note is stamped with the ticket it came from,
 *    and a stamped note is never carried again however loudly the write asks.
 *    A note that finds its way back onto the ticket (a relay, an integration
 *    replaying it) lands once and stops there instead of bouncing.
 *  - THE PAIR IS EXCLUDED. A customer ticket and its conversation are already
 *    one thread through the union read, so carrying a note across that link
 *    would show it twice.
 *  - TEAM-ONLY. The carried note is internal and broadcast on the agent
 *    channel alone; the customer's thread never shows internal work.
 *
 * The webhook bridges, realtime and notify are mocked (spy bags), so no event
 * pipeline, pub/sub, or email runs.
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

// config getters validate the full env (absent in tests); provide just what the
// attachment/avatar URL checks read (same stub the sibling suites use).
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => ticketEmit)

const convEmit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageNoteCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageDeleted: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationAssigned: vi.fn().mockResolvedValue(undefined),
  emitConversationPriorityChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatSubmitted: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatCommentAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../conversation/conversation.webhooks', () => convEmit)

const convNotify = vi.hoisted(() => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../conversation/conversation.notify', () => convNotify)

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
  and,
  eq,
  isNotNull,
  PERMISSIONS,
  type PermissionKey,
  type TicketType,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { addTicketNote } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
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

/** An agent carrying both the ticket-note and conversation-reply permissions —
 *  the carried note is written through the conversation domain's own note path,
 *  which re-authorizes under conversation.reply. */
function agentActor(principalId: PrincipalId): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_NOTE,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.CONVERSATION_REPLY,
    ]),
  }
}

async function seedStatus(): Promise<TicketStatusId> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id: statusId,
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
  })
  return statusId
}

async function seedTicket(statusId: TicketStatusId, type: TicketType): Promise<TicketId> {
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

async function link(
  ticketId: TicketId,
  conversationId: ConversationId,
  ticketType: TicketType
): Promise<void> {
  await testDb.insert(ticketConversations).values({ ticketId, conversationId, ticketType })
}

async function conversationMessagesOf(conversationId: ConversationId) {
  return testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
}

async function ticketNotesOf(ticketId: TicketId) {
  return testDb
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.ticketId, ticketId),
        eq(conversationMessages.isInternal, true),
        isNotNull(conversationMessages.principalId)
      )
    )
}

async function ticketReference(ticketId: TicketId): Promise<string> {
  const [row] = await testDb
    .select({ number: tickets.number })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return `#${row.number}`
}

describe.skipIf(!fixture.available)('ticket note cross-post (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    realtime.publishConversationEvent.mockClear()
    realtime.publishAgentConversationEvent.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('keeps a note on the ticket alone unless the author asks to share it', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'back_office')
    const conversationId = await seedConversation()
    await link(ticketId, conversationId, 'back_office')

    // The specialist's own working chatter: written with no sharing choice at
    // all, which is the overwhelming majority of what lands on a back-office
    // thread.
    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'Checked the export, the second column is off by one.',
    })

    expect(await ticketNotesOf(ticketId)).toHaveLength(1)
    // Ticket-only is the default, so the customer thread stays clean and the
    // agent channel never carries a copy it was not asked for.
    expect(await conversationMessagesOf(conversationId)).toHaveLength(0)
    expect(realtime.publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('carries a back-office ticket note onto the conversation it was opened from', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'back_office')
    const conversationId = await seedConversation()
    await link(ticketId, conversationId, 'back_office')

    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'Rerun the billing job, it cleared on the second pass.',
      shareWithConversation: true,
    })

    // The note is still the ticket's own — carrying it never moves it.
    const notes = await ticketNotesOf(ticketId)
    expect(notes).toHaveLength(1)

    const carried = await conversationMessagesOf(conversationId)
    expect(carried).toHaveLength(1)
    expect(carried[0].senderType).toBe('agent')
    expect(carried[0].isInternal).toBe(true)
    expect(carried[0].principalId).toBe(agentP)
    expect(carried[0].content).toContain('it cleared on the second pass')
    // It names the ticket it came from, so a thread carrying several links
    // stays legible.
    expect(carried[0].content).toContain(await ticketReference(ticketId))
    // Stamped with its origin — the mark loop safety keys off.
    expect(carried[0].metadata?.crossPostedFromTicketId).toBe(ticketId)
  })

  it('keeps the carried note team-only, off the customer channel', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'back_office')
    const conversationId = await seedConversation()
    await link(ticketId, conversationId, 'back_office')

    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'Waiting on the vendor.',
      shareWithConversation: true,
    })

    // Both halves of the team-only rule: the stored row every visitor read path
    // filters, and a broadcast that never touches the visitor's own channel.
    expect(realtime.publishAgentConversationEvent).toHaveBeenCalled()
    expect(realtime.publishConversationEvent).not.toHaveBeenCalled()
  })

  it('does not carry a note back again when it lands on the ticket a second time', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'back_office')
    const conversationId = await seedConversation()
    await link(ticketId, conversationId, 'back_office')

    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'Refund issued.',
      shareWithConversation: true,
    })
    const [carried] = await conversationMessagesOf(conversationId)

    // The carried note makes the round trip back onto the ticket, carrying its
    // origin stamp — what a relay or an integration replaying it would write,
    // asking to share as eagerly as the note it is echoing. The stamp outranks
    // the ask: sharing is what a human chose once, not a licence to keep
    // re-sharing the copy.
    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: carried.content,
      metadata: carried.metadata as Record<string, unknown>,
      shareWithConversation: true,
    })

    // It lands on the ticket thread once and stops: no second copy on the
    // conversation, so the two threads cannot bounce a note between them.
    expect(await ticketNotesOf(ticketId)).toHaveLength(2)
    expect(await conversationMessagesOf(conversationId)).toHaveLength(1)
  })

  it('never carries a customer ticket note across its pair link', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'customer')
    const conversationId = await seedConversation()
    await link(ticketId, conversationId, 'customer')

    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'Checked their plan.',
      shareWithConversation: true,
    })

    // The pair is one thread already (the union read serves both parents), so
    // a carried copy would show the note twice — asking for it changes nothing.
    expect(await ticketNotesOf(ticketId)).toHaveLength(1)
    expect(await conversationMessagesOf(conversationId)).toHaveLength(0)
  })

  it('leaves an unlinked back-office ticket note ticket-parented', async () => {
    const statusId = await seedStatus()
    const agentP = await seedPrincipal()
    const ticketId = await seedTicket(statusId, 'back_office')

    await addTicketNote(agentActor(agentP), {
      ticketId,
      content: 'No conversation behind this.',
      shareWithConversation: true,
    })

    expect(await ticketNotesOf(ticketId)).toHaveLength(1)
    expect(realtime.publishAgentConversationEvent).not.toHaveBeenCalled()
  })
})
