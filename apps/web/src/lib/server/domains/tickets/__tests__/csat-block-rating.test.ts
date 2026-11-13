/**
 * A rating given in the thread: it is recorded with or without a workflow run
 * waiting on it, and it never reopens a resolved ticket.
 *
 * The requester answers a csat block on the closed pair conversation through
 * the real visitor send. The `message.created` event goes through the real
 * webhook bridge and `emit()` into the outbox, and the queued pair-ticket
 * reopen reads the stored event. The stored payload carries the kind of block
 * the message answers, so the reopen can skip a rating.
 *
 * Controls with the same seeding: a plain message and a block reply that
 * matches no block both reopen the ticket and the conversation, so the rating
 * assertions cannot pass because nothing reopens.
 *
 * The rating is counted from what is stored: the rating, the
 * `conversation.csat_submitted` events in the outbox and the team marker.
 *
 * Real DB (rolled back). Realtime, the ticket event bridge, notifications and
 * the assistant are spied, so no fire-and-forget write races the fixture's
 * single connection.
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
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
  attributeCsatIfLastHandler: vi.fn().mockResolvedValue(undefined),
}))
// The real webhook bridge, with each send's fire-and-forget emit captured so
// the test can wait for the event to land in the outbox.
const pending = vi.hoisted(() => ({ emits: [] as Promise<unknown>[] }))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/server/domains/conversation/conversation.webhooks')>()
  const capture =
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
    (...args: A) => {
      const p = fn(...args)
      pending.emits.push(p)
      return p
    }
  return {
    ...real,
    emitMessageCreated: capture(real.emitMessageCreated),
    emitConversationCsatSubmitted: capture(real.emitConversationCsatSubmitted),
    emitConversationCsatCommentAdded: capture(real.emitConversationCsatCommentAdded),
  }
})

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  events,
  principal,
  settings,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  and,
  eq,
  sql,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { runEventReactions } from '@/lib/server/events/event-reactions-queue'
import { EVENT_REACTIONS_QUEUE } from '@/lib/server/events/event-reactions'
import { sendVisitorMessage } from '@/lib/server/domains/conversation/conversation.service'
import { applyAction } from '@/lib/server/domains/workflows/action.executor'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const anHourAgo = () => new Date(Date.now() - 60 * 60_000)

async function seedPrincipal(role: 'user' | 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

/**
 * A resolved customer ticket paired with a closed messenger conversation that
 * holds a csat block. Both were closed an hour before the test's transaction,
 * with no activity since, so a message written now postdates the close.
 */
async function seedResolvedPairWithCsatBlock() {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const received = createId('ticket_status') as TicketStatusId
  const resolved = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values([
    {
      id: received,
      name: 'C-Received',
      slug: `c_received_${suffix()}`,
      category: 'open',
      publicStage: 'received',
      position: -100,
      isDefault: true,
    },
    {
      id: resolved,
      name: 'C-Resolved',
      slug: `c_resolved_${suffix()}`,
      category: 'closed',
      publicStage: 'resolved',
      position: 103,
    },
  ])
  const requester = await seedPrincipal('user')
  const agent = await seedPrincipal('member')
  const closedAt = anHourAgo()
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      title: `T-${suffix()}`,
      statusId: resolved,
      type: 'customer',
      requesterPrincipalId: requester,
      resolvedAt: closedAt,
    })
    .returning()
  const ticketId = ticket.id as TicketId
  const conversationId = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({
    id: conversationId,
    visitorPrincipalId: requester,
    channel: 'messenger',
    status: 'closed',
    resolvedAt: closedAt,
  })
  await testDb
    .insert(ticketConversations)
    .values({ ticketId, conversationId, ticketType: 'customer' })
  const [block] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: agent,
      senderType: 'agent',
      content: 'How did we do?',
      metadata: {
        block: {
          v: 1,
          kind: 'csat',
          runId: 'run_test',
          nodeId: 'node_test',
          waiting: true,
          allowTypingInterrupt: true,
          commentPrompt: 'Anything else?',
        },
      },
      createdAt: closedAt,
    })
    .returning()
  return {
    requester,
    agent,
    ticketId,
    conversationId,
    blockMessageId: block.id as ConversationMessageId,
  }
}

function visitorActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
  } as Actor
}

async function send(
  conversationId: ConversationId,
  requester: PrincipalId,
  input: { content: string; blockReply?: Parameters<typeof sendVisitorMessage>[0]['blockReply'] }
) {
  const result = await sendVisitorMessage(
    { conversationId, ...input },
    { principalId: requester, displayName: 'Requester' },
    visitorActor(requester)
  )
  await Promise.all(pending.emits.splice(0))
  return result
}

/** The stored `message.created` event for one message. */
async function storedMessageEvent(messageId: string) {
  const [row] = await testDb
    .select()
    .from(events)
    .where(
      and(
        eq(events.type, 'message.created'),
        sql`${events.payload}->'message'->>'id' = ${messageId}`
      )
    )
  return row
}

/** The worker reaches the message event's reaction job. */
async function runReactionJob(eventId: string) {
  const [row] = getExecuteRows<{ job_id: string; payload: Record<string, unknown> }>(
    await testDb.execute(sql`
      SELECT job_id, payload FROM job_queue
      WHERE queue = ${EVENT_REACTIONS_QUEUE} AND payload->>'eventId' = ${eventId}
    `)
  )
  const job: ClaimedJob = {
    id: '1',
    jobId: row.job_id,
    queue: EVENT_REACTIONS_QUEUE,
    dedupeKey: `${EVENT_REACTIONS_QUEUE}:${eventId}`,
    payload: row.payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 3,
    leaseToken: 'test',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
  await runEventReactions(job)
}

async function state(ticketId: TicketId, conversationId: ConversationId) {
  const [t] = await testDb
    .select({ category: ticketStatuses.category, reopenedCount: tickets.reopenedCount })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .where(eq(tickets.id, ticketId))
  const [c] = await testDb
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return { ticket: t.category, reopenedCount: t.reopenedCount, conversation: c.status }
}

describe.skipIf(!fixture.available)('a rating never reopens a resolved ticket', () => {
  beforeEach(() => {
    pending.emits.length = 0
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('stores the csat kind on the message event, and the queued reopen leaves the ticket resolved', async () => {
    const { requester, ticketId, conversationId, blockMessageId } =
      await seedResolvedPairWithCsatBlock()

    const { message } = await send(conversationId, requester, {
      content: '',
      blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating: 5 },
    })

    const event = await storedMessageEvent(message.id)
    expect(event).toBeDefined()
    expect(
      (event.payload as { message: { blockReplyKind?: unknown } }).message.blockReplyKind
    ).toBe('csat')

    await runReactionJob(event.eventId)

    expect(await state(ticketId, conversationId)).toEqual({
      ticket: 'closed',
      reopenedCount: 0,
      conversation: 'closed',
    })
  })

  it('leaves the ticket resolved on a matched buttons reply, as it does the conversation', async () => {
    const { requester, ticketId, conversationId, agent } = await seedResolvedPairWithCsatBlock()
    const [buttons] = await testDb
      .insert(conversationMessages)
      .values({
        conversationId,
        principalId: agent,
        senderType: 'agent',
        content: 'Anything else?',
        metadata: {
          block: {
            v: 1,
            kind: 'buttons',
            runId: 'run_test',
            nodeId: 'node_buttons',
            waiting: true,
            allowTyping: false,
            options: [
              { key: 'yes', label: 'Yes please' },
              { key: 'no', label: 'No thanks' },
            ],
          },
        },
        createdAt: anHourAgo(),
      })
      .returning()

    const { message } = await send(conversationId, requester, {
      content: '',
      blockReply: { kind: 'buttons', inReplyToMessageId: buttons.id, buttonKey: 'yes' },
    })

    const event = await storedMessageEvent(message.id)
    expect(
      (event.payload as { message: { blockReplyKind?: unknown } }).message.blockReplyKind
    ).toBe('buttons')

    await runReactionJob(event.eventId)

    expect(await state(ticketId, conversationId)).toEqual({
      ticket: 'closed',
      reopenedCount: 0,
      conversation: 'closed',
    })
  })

  it('reopens both on a block reply that matches no block, whose event carries no kind', async () => {
    const { requester, ticketId, conversationId } = await seedResolvedPairWithCsatBlock()

    const { message } = await send(conversationId, requester, {
      content: 'Still broken',
      blockReply: {
        kind: 'csat',
        inReplyToMessageId: createId('conversation_message'),
        rating: 5,
      },
    })

    const event = await storedMessageEvent(message.id)
    expect(
      (event.payload as { message: { blockReplyKind?: unknown } }).message.blockReplyKind
    ).toBe(null)

    await runReactionJob(event.eventId)

    expect(await state(ticketId, conversationId)).toEqual({
      ticket: 'open',
      reopenedCount: 1,
      conversation: 'open',
    })
    // An unmatched block reply is a plain message: no rating is recorded.
    expect((await storedRating(conversationId)).rating).toBeNull()
  })

  it('drops a blockReply a caller supplies in metadata, so the thread reopens', async () => {
    const { requester, ticketId, conversationId, blockMessageId } =
      await seedResolvedPairWithCsatBlock()

    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'Still broken',
        metadata: {
          note: 'kept',
          blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating: 5 },
        } as never,
      },
      { principalId: requester, displayName: 'Requester' },
      visitorActor(requester)
    )
    await Promise.all(pending.emits.splice(0))

    const [stored] = await testDb
      .select({ metadata: conversationMessages.metadata })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, result.message.id as ConversationMessageId))
    expect(stored.metadata).toEqual({ note: 'kept' })
    expect((await state(ticketId, conversationId)).conversation).toBe('open')
    expect((await storedRating(conversationId)).rating).toBeNull()
  })

  it('reopens both on a plain message', async () => {
    const { requester, ticketId, conversationId } = await seedResolvedPairWithCsatBlock()

    const { message } = await send(conversationId, requester, { content: 'Still broken' })

    const event = await storedMessageEvent(message.id)
    expect(
      (event.payload as { message: { blockReplyKind?: unknown } }).message.blockReplyKind
    ).toBe(null)

    await runReactionJob(event.eventId)

    expect(await state(ticketId, conversationId)).toEqual({
      ticket: 'open',
      reopenedCount: 1,
      conversation: 'open',
    })
  })
})

/** What the conversation holds for its rating, counted from storage. */
async function storedRating(conversationId: ConversationId) {
  const [c] = await testDb
    .select({ rating: conversations.csatRating, comment: conversations.csatComment })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  const countEvents = async (type: string) =>
    (
      await testDb
        .select({ id: events.eventId })
        .from(events)
        .where(and(eq(events.type, type), eq(events.entityId, conversationId)))
    ).length
  const markers = await testDb
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        sql`${conversationMessages.metadata}->'systemEvent'->>'kind' = 'csat_submitted'`
      )
    )
  return {
    rating: c.rating,
    comment: c.comment,
    submittedEvents: await countEvents('conversation.csat_submitted'),
    commentEvents: await countEvents('conversation.csat_comment_added'),
    markers: markers.length,
  }
}

describe.skipIf(!fixture.available)('a rating given in the thread is recorded', () => {
  beforeEach(() => {
    pending.emits.length = 0
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('records a rating with no workflow run waiting on it', async () => {
    const { requester, conversationId, blockMessageId } = await seedResolvedPairWithCsatBlock()

    await send(conversationId, requester, {
      content: '',
      blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating: 4 },
    })

    expect(await storedRating(conversationId)).toEqual({
      rating: 4,
      comment: null,
      submittedEvents: 1,
      commentEvents: 0,
      markers: 1,
    })
  })

  it('a workflow run resuming on the same rating records it once', async () => {
    const { requester, conversationId, blockMessageId } = await seedResolvedPairWithCsatBlock()

    await send(conversationId, requester, {
      content: '',
      blockReply: {
        kind: 'csat',
        inReplyToMessageId: blockMessageId,
        rating: 5,
        comment: 'Quick fix, thanks',
      },
    })
    // The run waiting on the block resumes and records what it was given.
    await applyAction(
      { type: 'record_csat', rating: 5, comment: 'Quick fix, thanks' },
      { conversationId, actor: visitorActor(requester), runId: 'run_test' }
    )
    await Promise.all(pending.emits.splice(0))

    expect(await storedRating(conversationId)).toEqual({
      rating: 5,
      comment: 'Quick fix, thanks',
      submittedEvents: 1,
      commentEvents: 1,
      markers: 1,
    })
  })

  it('a resumed run never overwrites the rating the thread already recorded', async () => {
    const { requester, conversationId, blockMessageId } = await seedResolvedPairWithCsatBlock()

    await send(conversationId, requester, {
      content: '',
      blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating: 5 },
    })
    await applyAction(
      { type: 'record_csat', rating: 1 },
      { conversationId, actor: visitorActor(requester), runId: 'run_test' }
    )
    await Promise.all(pending.emits.splice(0))

    expect((await storedRating(conversationId)).rating).toBe(5)
  })

  it('refuses a block rating from someone who is not the requester', async () => {
    const { conversationId, blockMessageId } = await seedResolvedPairWithCsatBlock()
    const stranger = await seedPrincipal('user')

    await expect(
      send(conversationId, stranger, {
        content: '',
        blockReply: { kind: 'csat', inReplyToMessageId: blockMessageId, rating: 1 },
      })
    ).rejects.toThrow()

    expect(await storedRating(conversationId)).toEqual({
      rating: null,
      comment: null,
      submittedEvents: 0,
      commentEvents: 0,
      markers: 0,
    })
  })
})
