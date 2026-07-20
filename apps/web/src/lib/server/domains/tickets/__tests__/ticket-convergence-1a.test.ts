/**
 * Real-DB coverage for convergence Phase 1a (scratchpad/convergence-design.md,
 * mechanics appendix "Write (Phase 1)" + the side-effect model's notification
 * matrix). Runs inside the db-test-fixture rollback transaction. Covers:
 *
 *  - THE THREE-PATH WRITE REDIRECT: an agent/requester reply on a linked
 *    customer ticket lands CONVERSATION-parented via the full conversation
 *    write pipeline (lastMessageAt/preview, waitingSince, read stamps,
 *    `message.created` — the SLA hook's ride — and the notify dispatch);
 *    internal notes stay ticket-parented; back-office and standalone customer
 *    tickets are unchanged.
 *  - STAGE EVENTS: `postTicketStatusEvent` re-parents to the conversation on
 *    a linked pair, stays ticket-parented for back-office.
 *  - AUTO-REOPEN (dealbreaker 3): a visitor `message.created` on the pair
 *    conversation reopens an awaiting ticket via the event hook; open tickets
 *    and agent messages are no-ops; the hook never loops.
 *  - THE NOTIFICATION MATRIX: the redirect site emits `ticket.replied`
 *    alongside `message.created` (watcher fan-out preserved, both directions)
 *    and the presence-gated requester email (notifyAgentReply) still fires.
 *  - markTicketUnreadFromMessage's conversation-sourced anchor fallback.
 *
 * The two webhook bridges and realtime/notify are fully mocked (spy bags), so
 * no event pipeline, Redis, or email runs; the auto-reopen hook is exercised
 * directly with constructed events (the same pattern sla.event-hooks.test.ts
 * uses). SLA FRT/NRT settlement off `message.created` itself is covered by
 * sla.event-hooks.test.ts — here we assert the redirect EMITS the event on the
 * pair's conversation, which is the Phase 1a wiring.
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

// config getters validate the full env (absent in tests); provide just what the
// attachment/avatar URL checks read (same stub the sibling suites use).
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Neutralize the Redis-backed realtime fan-out on BOTH channels (the ticket
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

// The ticket-side event bridge: full spy bag (ticket.service emits created /
// status_changed / assigned; ticket-message.service emits replied / note_added).
const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => ticketEmit)

// The conversation-side event bridge: the delegates (sendVisitorMessage /
// sendAgentMessage / emitSystemMessage) emit through this. emitMessageCreated
// is the `message.created` assertion point for the redirect pipeline.
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

// The offline-email dispatch (presence-gated requester email / team email):
// spied so no presence or email pipeline runs, and so the matrix's
// agent-reply → requester email channel is assertable.
const convNotify = vi.hoisted(() => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../conversation/conversation.notify', () => convNotify)

// The assistant turn would otherwise fire on a redirected visitor reply to a
// widget-source conversation (full-pipeline behavior); stub it out of these
// tests entirely.
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))

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
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import type { EventData } from '@/lib/server/events/types'
import { sendTicketMessage, addTicketNote } from '../ticket-message.service'
import { replyToMyTicket } from '../requester.service'
import { setTicketStatus } from '../ticket.service'
import { autoReopenPairTicketFromEvent } from '../ticket.event-hooks'
import { markTicketUnreadFromMessage } from '../ticket-unread.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'member' | 'admin' = 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

/** An agent actor carrying BOTH the ticket and conversation reply perms — the
 *  redirect's delegate (sendAgentMessage) re-authorizes under
 *  conversation.reply (every preset role that grants ticket.reply grants it). */
function agentActor(principalId: PrincipalId, extra: PermissionKey[] = []): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
      PERMISSIONS.TICKET_SET_STATUS,
      PERMISSIONS.CONVERSATION_REPLY,
      ...extra,
    ]),
  }
}

function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

interface SeededStatuses {
  /** open category, 'received' stage, default. */
  received: TicketStatusId
  /** open category, 'in_progress' stage. */
  inProgress: TicketStatusId
  /** pending category, 'awaiting_requester' stage. */
  awaiting: TicketStatusId
}

/** Seed the three statuses the stage/reopen scenarios need (positions well
 *  clear of any migration-seeded rows), plus the workspace settings row
 *  stage-label resolution reads (getStageLabels → requireSettings). */
async function seedStatuses(): Promise<SeededStatuses> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const received = createId('ticket_status') as TicketStatusId
  const inProgress = createId('ticket_status') as TicketStatusId
  const awaiting = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values([
    {
      id: received,
      name: 'T-Received',
      slug: `t_received_${suffix()}`,
      category: 'open',
      publicStage: 'received',
      position: 100,
      isDefault: true,
    },
    {
      id: inProgress,
      name: 'T-InProgress',
      slug: `t_inprogress_${suffix()}`,
      category: 'open',
      publicStage: 'in_progress',
      position: 101,
    },
    {
      id: awaiting,
      name: 'T-Awaiting',
      slug: `t_awaiting_${suffix()}`,
      category: 'pending',
      publicStage: 'awaiting_requester',
      position: 102,
    },
  ])
  return { received, inProgress, awaiting }
}

async function seedTicket(opts: {
  statusId: TicketStatusId
  type?: 'customer' | 'back_office'
  requesterPrincipalId?: PrincipalId
}): Promise<TicketId> {
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id: ticketId,
    title: `T-${suffix()}`,
    statusId: opts.statusId,
    type: opts.type ?? 'customer',
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

async function readConversation(conversationId: ConversationId) {
  const [row] = await testDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row
}

async function readTicket(ticketId: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, ticketId))
  return row
}

async function ticketStatusCategory(ticketId: TicketId): Promise<string | null> {
  const [row] = await testDb
    .select({ category: ticketStatuses.category })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .where(eq(tickets.id, ticketId))
  return row?.category ?? null
}

/** A visitor `message.created` event, shaped like the dispatch payload (the
 *  hook only reads message.conversationId / senderType / authorPrincipalId). */
function visitorMessageCreated(
  conversationId: ConversationId,
  opts: { senderType?: 'visitor' | 'agent'; authorPrincipalId?: PrincipalId } = {}
): EventData {
  return {
    type: 'message.created',
    timestamp: new Date().toISOString(),
    data: {
      message: {
        conversationId,
        senderType: opts.senderType ?? 'visitor',
        authorPrincipalId: opts.authorPrincipalId ?? null,
      },
    },
  } as unknown as EventData
}

describe.skipIf(!fixture.available)('convergence Phase 1a (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('write redirect — agent reply on a linked customer ticket', () => {
    it('lands conversation-parented and runs the full conversation write pipeline', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      const { message } = await sendTicketMessage(agentActor(agentP), {
        ticketId,
        content: 'On it.',
      })

      // The row is conversation-parented (the ticket thread reads it via the
      // Phase 0 union loader).
      expect(message.conversationId).toBe(conversationId)
      expect(message.ticketId).toBeNull()
      expect(message.senderType).toBe('agent')
      expect(message.isInternal).toBe(false)

      // The conversation write pipeline moved the denormalized fields: an
      // agent reply bumps last-message, stamps the agent read side, claims
      // the unassigned conversation, and stops the wait clock.
      const conversation = await readConversation(conversationId)
      expect(conversation.lastMessagePreview).toBe('On it.')
      expect(conversation.lastMessageAt?.toISOString()).toBe(message.createdAt)
      expect(conversation.agentLastReadAt?.toISOString()).toBe(message.createdAt)
      expect(conversation.waitingSince).toBeNull()
      expect(conversation.assignedAgentPrincipalId).toBe(agentP)

      // Redirect invariants: the ticket's activity ordering bump survives…
      const ticket = await readTicket(ticketId)
      expect(ticket.updatedAt?.toISOString()).toBe(message.createdAt)
      // …but first_response_at is deliberately NOT stamped — the
      // conversation's first-response machinery owns the pair's timeline.
      expect(ticket.firstResponseAt).toBeNull()

      // `message.created` fired on the conversation (the SLA event hook's
      // FRT/NRT settle rides it)…
      expect(convEmit.emitMessageCreated).toHaveBeenCalledTimes(1)
      const [, , emittedMessage, emittedConversation, isFirstMessage] =
        convEmit.emitMessageCreated.mock.calls[0]
      expect(emittedMessage.conversationId).toBe(conversationId)
      expect(emittedMessage.senderType).toBe('agent')
      expect(emittedConversation.id).toBe(conversationId)
      expect(isFirstMessage).toBe(false)
      // …and the matrix's ticket-side `ticket.replied` fired ALONGSIDE it
      // (watcher fan-out + the requester's always-on email).
      expect(ticketEmit.emitTicketReplied).toHaveBeenCalledTimes(1)
      expect(ticketEmit.emitTicketReplied.mock.calls[0][2].id).toBe(message.id)
      // The presence-gated requester email on the conversation side also
      // fires (both channels, no cross-channel dedupe in v1).
      expect(convNotify.notifyAgentReply).toHaveBeenCalledTimes(1)

      // Realtime: the delegate's conversation-channel publish plus the
      // redirect's dual-publish on the team-only ticket channel.
      expect(realtime.publishConversationEvent).toHaveBeenCalled()
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(ticketId, {
        kind: 'ticket_message',
        ticketId,
        message,
      })
    })

    it('keeps an internal note ticket-parented on a linked pair (Intercom ticket notes)', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      const { message } = await addTicketNote(agentActor(agentP), {
        ticketId,
        content: 'internal only',
      })

      expect(message.ticketId).toBe(ticketId)
      expect(message.conversationId).toBeNull()
      expect(message.isInternal).toBe(true)
      // No conversation pipeline touched: no preview bump, no message.created,
      // no requester email.
      const conversation = await readConversation(conversationId)
      expect(conversation.lastMessagePreview).toBeNull()
      expect(convEmit.emitMessageCreated).not.toHaveBeenCalled()
      expect(convNotify.notifyAgentReply).not.toHaveBeenCalled()
      expect(ticketEmit.emitTicketNoteAdded).toHaveBeenCalledTimes(1)
    })

    it('leaves a back-office ticket reply ticket-parented (never conversation-linked)', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const ticketId = await seedTicket({ statusId: statuses.received, type: 'back_office' })

      const { message } = await sendTicketMessage(agentActor(agentP), {
        ticketId,
        content: 'internal reply',
      })

      expect(message.ticketId).toBe(ticketId)
      expect(message.conversationId).toBeNull()
      expect(convEmit.emitMessageCreated).not.toHaveBeenCalled()
      // Legacy behavior: the ticket-side first_response_at stamp still fires
      // on the un-redirected path.
      expect((await readTicket(ticketId)).firstResponseAt).not.toBeNull()
    })

    it('leaves a STANDALONE customer ticket reply ticket-parented (pre-1b legacy)', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })

      const { message } = await sendTicketMessage(agentActor(agentP), {
        ticketId,
        content: 'standalone reply',
      })

      expect(message.ticketId).toBe(ticketId)
      expect(message.conversationId).toBeNull()
      expect(convEmit.emitMessageCreated).not.toHaveBeenCalled()
    })
  })

  describe('write redirect — requester reply on a linked customer ticket', () => {
    it('lands conversation-parented, arms the wait clock, reopens the ticket, and emits ticket.replied', async () => {
      const statuses = await seedStatuses()
      const requesterP = await seedPrincipal()
      // The ticket is waiting on the customer; the pair conversation belongs
      // to the requester (sendVisitorMessage's ownership gate).
      const ticketId = await seedTicket({
        statusId: statuses.awaiting,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      const { message } = await replyToMyTicket(requesterActor(requesterP), {
        ticketId,
        content: 'still broken',
      })

      expect(message.conversationId).toBe(conversationId)
      expect(message.ticketId).toBeNull()
      expect(message.senderType).toBe('visitor')

      // The conversation pipeline: the customer is now waiting on a reply —
      // the NRT clock arms (the changelog-flagged attainment shift) — and the
      // visitor's own read side stamps.
      const conversation = await readConversation(conversationId)
      expect(conversation.lastMessagePreview).toBe('still broken')
      expect(conversation.waitingSince?.toISOString()).toBe(message.createdAt)
      expect(conversation.visitorLastReadAt?.toISOString()).toBe(message.createdAt)

      // The ticket still bumps updatedAt (the redirect stamps the message's
      // createdAt, and the auto-reopen's own status write then bumps it
      // further) and auto-reopens off the requester reply (the direct call in
      // appendRequesterReply — same function the event hook uses, idempotent).
      const ticket = await readTicket(ticketId)
      expect(ticket.updatedAt?.getTime()).toBeGreaterThanOrEqual(
        new Date(message.createdAt).getTime()
      )
      expect(await ticketStatusCategory(ticketId)).toBe('open')
      expect(ticketEmit.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
      expect(ticketEmit.emitTicketStatusChanged.mock.calls[0][2]).toBe('pending')
      expect(ticketEmit.emitTicketStatusChanged.mock.calls[0][3]).toBe('open')

      // The matrix: `ticket.replied` fires alongside `message.created` for the
      // REQUESTER direction too (watchers other than the requester hear about
      // customer replies).
      expect(convEmit.emitMessageCreated).toHaveBeenCalledTimes(1)
      expect(convEmit.emitMessageCreated.mock.calls[0][2].senderType).toBe('visitor')
      expect(ticketEmit.emitTicketReplied).toHaveBeenCalledTimes(1)
      expect(ticketEmit.emitTicketReplied.mock.calls[0][2].senderType).toBe('visitor')
    })
  })

  describe('stage events (postTicketStatusEvent)', () => {
    it('posts the stage event conversation-parented on a linked pair', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      await setTicketStatus(ticketId, statuses.inProgress, agentActor(agentP))

      const conversationRows = await testDb
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            eq(conversationMessages.senderType, 'system')
          )
        )
      expect(conversationRows).toHaveLength(1)
      expect(conversationRows[0].metadata?.systemEvent?.kind).toBe('ticket_status_changed')
      expect(conversationRows[0].content).toContain('Status updated to')

      // Nothing landed on the ticket parent.
      const ticketRows = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, ticketId))
      expect(ticketRows).toHaveLength(0)
    })

    it('keeps a back-office stage event ticket-parented', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const ticketId = await seedTicket({ statusId: statuses.received, type: 'back_office' })

      await setTicketStatus(ticketId, statuses.inProgress, agentActor(agentP))

      const ticketRows = await testDb
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, ticketId),
            eq(conversationMessages.senderType, 'system')
          )
        )
      expect(ticketRows).toHaveLength(1)
      expect(ticketRows[0].metadata?.systemEvent?.kind).toBe('ticket_status_changed')
    })
  })

  describe('auto-reopen on a visitor message (dealbreaker 3)', () => {
    it('reopens an awaiting ticket on a visitor message.created on the pair conversation', async () => {
      const statuses = await seedStatuses()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.awaiting,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      await autoReopenPairTicketFromEvent(
        visitorMessageCreated(conversationId, { authorPrincipalId: requesterP })
      )

      expect(await ticketStatusCategory(ticketId)).toBe('open')
      // The reopen emits the same ticket.status_changed signal an agent's
      // status move does (the SLA pending-resume and watcher notifications
      // ride it) — exactly once.
      expect(ticketEmit.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
      expect(ticketEmit.emitTicketStatusChanged.mock.calls[0][2]).toBe('pending')
      expect(ticketEmit.emitTicketStatusChanged.mock.calls[0][3]).toBe('open')

      // Idempotent / no loop: a second delivery of the same event is a no-op
      // (the ticket is already open), and feeding the reopen's own
      // ticket.status_changed-shaped input back into the hook changes nothing
      // — the hook only reacts to visitor message.created.
      await autoReopenPairTicketFromEvent(
        visitorMessageCreated(conversationId, { authorPrincipalId: requesterP })
      )
      expect(ticketEmit.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
    })

    it('does not reopen an already-open ticket', async () => {
      const statuses = await seedStatuses()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      await autoReopenPairTicketFromEvent(
        visitorMessageCreated(conversationId, { authorPrincipalId: requesterP })
      )

      expect((await readTicket(ticketId)).statusId).toBe(statuses.received)
      expect(ticketEmit.emitTicketStatusChanged).not.toHaveBeenCalled()
    })

    it('ignores agent messages and pair-less conversations', async () => {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.awaiting,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)

      // An AGENT message on the pair conversation never reopens.
      await autoReopenPairTicketFromEvent(
        visitorMessageCreated(conversationId, {
          senderType: 'agent',
          authorPrincipalId: agentP,
        })
      )
      // A visitor message on an UNRELATED (pair-less) conversation never does.
      const otherConversationId = await seedConversation(requesterP)
      await autoReopenPairTicketFromEvent(
        visitorMessageCreated(otherConversationId, { authorPrincipalId: requesterP })
      )

      expect(await ticketStatusCategory(ticketId)).toBe('pending')
      expect(ticketEmit.emitTicketStatusChanged).not.toHaveBeenCalled()
    })
  })

  describe('markTicketUnreadFromMessage — union-sourced anchors', () => {
    async function seedPairWithConversationMessage() {
      const statuses = await seedStatuses()
      const agentP = await seedPrincipal()
      const requesterP = await seedPrincipal()
      const ticketId = await seedTicket({
        statusId: statuses.received,
        requesterPrincipalId: requesterP,
      })
      const conversationId = await seedConversation(requesterP)
      await linkPair(ticketId, conversationId)
      const anchorAt = new Date('2026-07-10T12:00:00Z')
      const [anchor] = await testDb
        .insert(conversationMessages)
        .values({
          conversationId,
          principalId: requesterP,
          senderType: 'visitor',
          content: 'a messenger reply',
          createdAt: anchorAt,
        })
        .returning()
      return { agentP, ticketId, conversationId, anchor }
    }

    it('falls back to the conversation watermark for a conversation-parented anchor', async () => {
      const { agentP, ticketId, conversationId, anchor } = await seedPairWithConversationMessage()
      // The agent had read up to now; marking unread from the anchor rewinds
      // the CONVERSATION watermark to just before it.
      const readAt = new Date('2026-07-11T00:00:00Z')
      await testDb
        .update(conversations)
        .set({ agentLastReadAt: readAt })
        .where(eq(conversations.id, conversationId))

      await markTicketUnreadFromMessage(
        ticketId,
        anchor.id as ConversationMessageId,
        agentActor(agentP)
      )

      const conversation = await readConversation(conversationId)
      expect(conversation.agentLastReadAt?.toISOString()).toBe(
        new Date(anchor.createdAt.getTime() - 1).toISOString()
      )
      // The ticket's own watermark columns are untouched — the pair's truth
      // is the conversation watermark.
      expect((await readTicket(ticketId)).assigneeLastReadAt).toBeNull()
    })

    it('PHASE 3: a ticket-parented legacy anchor on a pair moves the CONVERSATION watermark, never the retired ticket column', async () => {
      const { agentP, ticketId, conversationId } = await seedPairWithConversationMessage()
      const readAt = new Date('2026-07-11T00:00:00Z')
      await testDb
        .update(conversations)
        .set({ agentLastReadAt: readAt })
        .where(eq(conversations.id, conversationId))
      // A frozen pre-link ticket watermark stays EXACTLY as it was — Phase 3
      // stopped the last writer of the legacy column for pairs.
      const frozen = new Date('2026-07-09T00:00:00Z')
      await testDb
        .update(tickets)
        .set({ assigneeLastReadAt: frozen })
        .where(eq(tickets.id, ticketId))
      const anchorAt = new Date('2026-07-10T12:00:00Z')
      const [anchor] = await testDb
        .insert(conversationMessages)
        .values({
          ticketId,
          principalId: null,
          senderType: 'system',
          content: 'legacy',
          createdAt: anchorAt,
        })
        .returning()

      await markTicketUnreadFromMessage(
        ticketId,
        anchor.id as ConversationMessageId,
        agentActor(agentP)
      )

      // The pair's truth — the conversation's agent watermark — rewound to
      // just before the anchor; the retired ticket column is untouched.
      expect((await readConversation(conversationId)).agentLastReadAt?.toISOString()).toBe(
        new Date(anchorAt.getTime() - 1).toISOString()
      )
      expect((await readTicket(ticketId)).assigneeLastReadAt?.toISOString()).toBe(
        frozen.toISOString()
      )
    })

    it('404s on an anchor from an unrelated conversation', async () => {
      const { agentP, ticketId } = await seedPairWithConversationMessage()
      const requesterP = await seedPrincipal()
      const otherConversationId = await seedConversation(requesterP)
      const [anchor] = await testDb
        .insert(conversationMessages)
        .values({
          conversationId: otherConversationId,
          principalId: requesterP,
          senderType: 'visitor',
          content: 'not your pair',
        })
        .returning()

      await expect(
        markTicketUnreadFromMessage(
          ticketId,
          anchor.id as ConversationMessageId,
          agentActor(agentP)
        )
      ).rejects.toThrow(/not found/i)
    })
  })
})
