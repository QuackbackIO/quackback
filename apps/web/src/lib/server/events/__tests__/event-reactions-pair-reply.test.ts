/**
 * A customer ticket and the conversation it is paired with are one thread, and
 * every customer-visible message on it lands on the conversation, whichever
 * surface wrote it: the inbox's conversation row, the requester's Messenger,
 * conversation email, or the ticket reply paths (which redirect there). The
 * pair-reply reaction turns each such `message.created` into the ticket's
 * `ticket.replied`, so the ticket's watchers hear about every reply, and keeps
 * the same watch rules as the ticket paths: a teammate who replies watches the
 * ticket, a requester who replies watches it again.
 *
 * Real DB (rolled back), real legacy dispatch, real outbox and the real
 * reaction handler. Only realtime and the ticket event bridge are spied, so
 * the emitted reply is recorded with the arguments it received.
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
const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketRepliedAs: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ticketEmit)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  events,
  principal,
  ticketConversations,
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  user,
  and,
  eq,
  sql,
} from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import * as dispatch from '../dispatch'
import { runEventReactions } from '../event-reactions-queue'
import { EVENT_REACTIONS_QUEUE } from '../event-reactions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketSubscriptions.id }).from(ticketSubscriptions).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(
  role: 'member' | 'user',
  type: 'user' | 'service' = 'user'
): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  if (type === 'service') {
    await testDb
      .insert(principal)
      .values({ id: principalId, role, type, displayName: 'Bot', createdAt: new Date() })
    return principalId
  }
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type, createdAt: new Date() })
  return principalId
}

async function seedTicket(opts: { paired: boolean }) {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id: statusId,
    name: 'R-Open',
    slug: `r_open_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 900,
  })
  const requester = await seedPrincipal('user')
  const agent = await seedPrincipal('member')
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      title: `T-${suffix()}`,
      statusId,
      type: 'customer',
      requesterPrincipalId: requester,
    })
    .returning()
  const ticketId = ticket.id as TicketId
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: requester, channel: 'messenger' })
  if (opts.paired) {
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })
  }
  return { requester, agent, ticketId, conversationId }
}

/** A message written on the conversation, announced through the legacy dispatch. */
async function writeOnConversation(
  conversationId: ConversationId,
  author: PrincipalId,
  senderType: 'agent' | 'visitor',
  opts: { internal?: boolean; deleted?: boolean } = {}
): Promise<ConversationMessageId> {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: author,
      senderType,
      content: 'Here is the fix',
      isInternal: opts.internal ?? false,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning()
  await dispatch.dispatchMessageCreated(
    { type: 'user', principalId: author, displayName: 'Someone' },
    {
      id: row.id,
      conversationId,
      senderType,
      authorPrincipalId: author,
      authorName: 'Someone',
      authorEmail: null,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    },
    {
      id: conversationId,
      status: 'open',
      channel: 'messenger',
      priority: 'medium',
      assignedTeamId: null,
    },
    false
  )
  return row.id as ConversationMessageId
}

async function runReactionJobFor(conversationId: ConversationId) {
  const [event] = await testDb.select().from(events).where(eq(events.entityId, conversationId))
  const [row] = getExecuteRows<{
    job_id: string
    payload: Record<string, unknown>
    max_attempts: number
  }>(
    await testDb.execute(sql`
      SELECT job_id, payload, max_attempts FROM job_queue
      WHERE queue = ${EVENT_REACTIONS_QUEUE} AND payload->>'eventId' = ${event.eventId}
    `)
  )
  const job: ClaimedJob = {
    id: '1',
    jobId: row.job_id,
    queue: EVENT_REACTIONS_QUEUE,
    dedupeKey: `${EVENT_REACTIONS_QUEUE}:${event.eventId}`,
    payload: row.payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: row.max_attempts,
    leaseToken: 'test',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
  await runEventReactions(job)
}

async function watchReason(ticketId: TicketId, principalId: PrincipalId) {
  const [row] = await testDb
    .select({ reason: ticketSubscriptions.reason })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
  return row?.reason ?? null
}

describe.skipIf(!fixture.available)('pair-ticket reply from the conversation side', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it("turns a teammate's reply on the conversation row into the ticket's reply", async () => {
    const { agent, ticketId, conversationId } = await seedTicket({ paired: true })

    const messageId = await writeOnConversation(conversationId, agent, 'agent')
    await runReactionJobFor(conversationId)

    expect(ticketEmit.emitTicketRepliedAs).toHaveBeenCalledTimes(1)
    const [eventActor, ticket, message] = ticketEmit.emitTicketRepliedAs.mock.calls[0]
    expect(eventActor).toMatchObject({ principalId: agent })
    expect(ticket.id).toBe(ticketId)
    expect(message).toMatchObject({
      id: messageId,
      senderType: 'agent',
      content: 'Here is the fix',
    })
    // Replying makes the teammate a watcher, as replying on the ticket does.
    expect(await watchReason(ticketId, agent)).toBe('replier')
  })

  it("turns the requester's Messenger reply into the ticket's reply and re-subscribes them", async () => {
    const { requester, ticketId, conversationId } = await seedTicket({ paired: true })

    await writeOnConversation(conversationId, requester, 'visitor')
    await runReactionJobFor(conversationId)

    expect(ticketEmit.emitTicketRepliedAs).toHaveBeenCalledTimes(1)
    expect(ticketEmit.emitTicketRepliedAs.mock.calls[0][2].senderType).toBe('visitor')
    expect(await watchReason(ticketId, requester)).toBe('requester')
  })

  it('keeps an existing watch, mute and reason, as the ticket paths do', async () => {
    const { agent, ticketId, conversationId } = await seedTicket({ paired: true })
    const mutedUntil = new Date(Date.now() + 86_400_000)
    await testDb
      .insert(ticketSubscriptions)
      .values({ ticketId, principalId: agent, reason: 'assignee', mutedUntil })

    await writeOnConversation(conversationId, agent, 'agent')
    await runReactionJobFor(conversationId)

    const [row] = await testDb
      .select()
      .from(ticketSubscriptions)
      .where(eq(ticketSubscriptions.ticketId, ticketId))
    expect(row.reason).toBe('assignee')
    expect(row.mutedUntil?.getTime()).toBe(mutedUntil.getTime())
  })

  it('announces a service principal reply without making it a watcher', async () => {
    const { ticketId, conversationId } = await seedTicket({ paired: true })
    const bot = await seedPrincipal('user', 'service')

    await writeOnConversation(conversationId, bot, 'agent')
    await runReactionJobFor(conversationId)

    expect(ticketEmit.emitTicketRepliedAs).toHaveBeenCalledTimes(1)
    expect(await watchReason(ticketId, bot)).toBeNull()
  })

  it('stays silent for an internal note or a message deleted before the job ran', async () => {
    const note = await seedTicket({ paired: true })
    await writeOnConversation(note.conversationId, note.agent, 'agent', { internal: true })
    await runReactionJobFor(note.conversationId)

    const deleted = await seedTicket({ paired: true })
    await writeOnConversation(deleted.conversationId, deleted.agent, 'agent', { deleted: true })
    await runReactionJobFor(deleted.conversationId)

    expect(ticketEmit.emitTicketRepliedAs).not.toHaveBeenCalled()
    expect(await watchReason(note.ticketId, note.agent)).toBeNull()
  })

  it('leaves a conversation with no ticket alone', async () => {
    const { agent, ticketId, conversationId } = await seedTicket({ paired: false })

    await writeOnConversation(conversationId, agent, 'agent')
    await runReactionJobFor(conversationId)

    expect(ticketEmit.emitTicketRepliedAs).not.toHaveBeenCalled()
    expect(await watchReason(ticketId, agent)).toBeNull()
  })
})
