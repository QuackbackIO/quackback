/**
 * Real-DB coverage for the tracker reply-all (support platform §4.9's
 * message-axis counterpart of the status cascade): an agent reply on a
 * `tracker` ticket, sent with `replyAll`, lands a copy on every customer
 * ticket the tracker tracks — through each linked ticket's own write path, so
 * a paired ticket's copy lands CONVERSATION-parented (the Phase 1a redirect)
 * and a standalone ticket keeps its own thread. Every copy is stamped
 * `repliedAllFromTicketId`; a reply already carrying the stamp never fans
 * again. Runs inside the db-test-fixture rollback transaction; the webhook
 * bridges, realtime, and notify dispatch are fully mocked (spy bags, the same
 * pattern ticket-convergence-1a.test.ts uses).
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

// Neutralize the Postgres-backed realtime fan-out on BOTH channels (the ticket
// channel the redirect dual-publishes on, and the conversation channel the
// delegates publish on).
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// The ticket-side event bridge (sendTicketMessage emits ticket.replied).
const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => ticketEmit)

// The conversation-side event bridge: the paired copy's delegate
// (sendAgentMessage) emits through this.
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

// The offline-email dispatch: spied so no presence or email pipeline runs.
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
  ticketConversations,
  ticketLinks,
  tickets,
  ticketStatuses,
  user,
  eq,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { sendTicketMessage, listTicketMessages } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketLinks.trackerTicketId }).from(ticketLinks).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** An agent actor carrying BOTH the ticket and conversation reply perms — the
 *  paired copy's delegate (sendAgentMessage) re-authorizes under
 *  conversation.reply (every preset role that grants ticket.reply grants it). */
async function seedAgent(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.CONVERSATION_REPLY,
    ]),
  }
}

async function seedTicket(type: 'customer' | 'tracker'): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `ra-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: `T-${suffix()}`, statusId, type })
  return ticketId
}

async function seedConversation(): Promise<ConversationId> {
  const visitorId = createId('principal') as PrincipalId
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: visitorId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: visitorId, channel: 'messenger' })
  return conversationId
}

async function track(trackerId: TicketId, linkedId: TicketId): Promise<void> {
  await testDb
    .insert(ticketLinks)
    .values({ trackerTicketId: trackerId, linkedTicketId: linkedId, relation: 'tracks' })
}

/** The raw rows a fanned copy landed as, wherever the linked ticket's write
 *  path parented them (conversation-parented on a pair, ticket-parented on a
 *  standalone). */
async function copiesOf(content: string) {
  const rows = await testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.content, content))
  return rows.filter((r) => !r.deletedAt)
}

describe.skipIf(!fixture.available)('tracker reply-all (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('fans the reply into every linked customer conversation + standalone thread', async () => {
    const actor = await seedAgent()
    const tracker = await seedTicket('tracker')
    const paired = await seedTicket('customer')
    const standalone = await seedTicket('customer')
    const conversationId = await seedConversation()
    await testDb
      .insert(ticketConversations)
      .values({ ticketId: paired, conversationId, ticketType: 'customer' })
    await track(tracker, paired)
    await track(tracker, standalone)

    const content = `Fix ships in 1.2.3 ${suffix()}`
    await sendTicketMessage(actor, { ticketId: tracker, content, replyAll: true })

    const copies = await copiesOf(content)
    // The original on the tracker thread + one copy per linked ticket.
    expect(copies).toHaveLength(3)

    // The original stays ticket-parented on the tracker, unstamped.
    const original = copies.find((r) => r.ticketId === tracker)
    expect(original).toBeDefined()
    expect(original?.senderType).toBe('agent')
    expect(original?.isInternal).toBe(false)
    expect(original?.metadata?.repliedAllFromTicketId).toBeUndefined()

    // The paired ticket's copy landed in its CONVERSATION (the Phase 1a
    // redirect), customer-visible, stamped with the tracker it came from.
    const pairCopy = copies.find((r) => r.conversationId === conversationId)
    expect(pairCopy).toBeDefined()
    expect(pairCopy?.ticketId).toBeNull()
    expect(pairCopy?.senderType).toBe('agent')
    expect(pairCopy?.isInternal).toBe(false)
    expect(pairCopy?.metadata?.repliedAllFromTicketId).toBe(tracker)

    // The standalone ticket's copy landed on its own thread, same stamp.
    const standaloneCopy = copies.find((r) => r.ticketId === standalone)
    expect(standaloneCopy).toBeDefined()
    expect(standaloneCopy?.metadata?.repliedAllFromTicketId).toBe(tracker)

    // The requester-facing thread of each linked ticket shows the reply.
    for (const linkedId of [paired, standalone]) {
      const page = await listTicketMessages(linkedId, { includeInternal: false })
      expect(page.messages.find((m) => m.content === content)).toBeDefined()
    }
    // ...and the paired copy ran the conversation pipeline's event bridge.
    expect(convEmit.emitMessageCreated).toHaveBeenCalled()
  })

  it('leaves the linked tickets alone without the reply-all ask', async () => {
    const actor = await seedAgent()
    const tracker = await seedTicket('tracker')
    const linked = await seedTicket('customer')
    await track(tracker, linked)

    const content = `Tracker-internal update ${suffix()}`
    await sendTicketMessage(actor, { ticketId: tracker, content })

    const copies = await copiesOf(content)
    expect(copies).toHaveLength(1)
    expect(copies[0].ticketId).toBe(tracker)
  })

  it('never fans a copy again — the repliedAllFromTicketId stamp outranks the ask', async () => {
    const actor = await seedAgent()
    const tracker = await seedTicket('tracker')
    const origin = await seedTicket('tracker')
    const linked = await seedTicket('customer')
    await track(tracker, linked)

    const content = `Relayed copy ${suffix()}`
    await sendTicketMessage(actor, {
      ticketId: tracker,
      content,
      replyAll: true,
      metadata: { repliedAllFromTicketId: origin },
    })

    // The reply lands on the tracker alone: it already carries the stamp, so
    // it is a copy, not an original a human asked to fan out.
    const copies = await copiesOf(content)
    expect(copies).toHaveLength(1)
    expect(copies[0].ticketId).toBe(tracker)
  })
})
