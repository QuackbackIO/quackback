/**
 * A customer ticket born with its conversation (the intake pair) takes its
 * first response from the replies on that conversation. A redirected reply
 * lands on the conversation, so the ticket's value is set by the
 * `ticket-first-response` reaction to its `message.created`, and moved again
 * by the reaction to a `message.deleted`. The reaction reads the rows, so it
 * gives the same value whether its jobs run in order, out of order or twice.
 *
 * Real DB (rolled back), real intake, real redirect, real dispatch and outbox,
 * and the real reaction job handler. Realtime, notifications, the ticket event
 * bridge and the assistant are spied, as in ticket-convergence-1b.test.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
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
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)
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
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  events,
  principal,
  settings,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  and,
  asc,
  eq,
  sql,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { runEventReactions } from '../event-reactions-queue'
import { EVENT_REACTIONS, EVENT_REACTIONS_QUEUE } from '../event-reactions'
import { createTicketCore } from '@/lib/server/domains/tickets/ticket.service'
import { sendTicketMessage } from '@/lib/server/domains/tickets/ticket-message.service'
import { deleteConversationMessage } from '@/lib/server/domains/conversation/conversation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function seedDefaultStatus(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    id: createId('ticket_status') as TicketStatusId,
    name: 'F-Received',
    slug: `f_received_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
    isDefault: true,
  })
}

function agentActor(principalId: PrincipalId): Actor {
  return {
    ...ANONYMOUS_ACTOR,
    principalId,
    principalType: 'user',
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.CONVERSATION_REPLY,
      PERMISSIONS.CONVERSATION_VIEW_ALL,
    ]),
  }
}

/** The customer files a ticket; the pair and the opening message are written. */
async function intake() {
  await seedDefaultStatus()
  const requester = await seedPrincipal('user')
  const agent = await seedPrincipal('member')
  const dto = await createTicketCore(
    {
      type: 'customer',
      title: 'Cannot export my data',
      description: 'The export button spins forever.',
      requesterPrincipalId: requester,
      withBackingConversation: true,
    },
    { ...ANONYMOUS_ACTOR, principalId: requester, principalType: 'user' }
  )
  const ticketId = dto.id as TicketId
  const [link] = await testDb
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(eq(ticketConversations.ticketId, ticketId))
  const conversationId = link.conversationId as ConversationId
  // Every row in the test transaction shares now(); the customer wrote an
  // hour before the replies.
  await testDb
    .update(conversationMessages)
    .set({ createdAt: new Date(Date.now() - 3_600_000) })
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'visitor')
      )
    )
  return { ticketId, conversationId, agent }
}

/**
 * The reaction jobs queued for the conversation's events of `type`, in written
 * order, once `count` are there: the conversation service emits its events
 * without waiting for them.
 */
async function reactionJobs(
  conversationId: ConversationId,
  type: string,
  count: number
): Promise<ClaimedJob[]> {
  await vi.waitFor(
    async () => {
      const rows = await testDb
        .select({ eventId: events.eventId })
        .from(events)
        .where(and(eq(events.entityId, conversationId), eq(events.type, type)))
      expect(rows).toHaveLength(count)
    },
    { timeout: 10_000 }
  )
  return queuedJobs(conversationId, type)
}

async function queuedJobs(conversationId: ConversationId, type: string): Promise<ClaimedJob[]> {
  const written = await testDb
    .select({ eventId: events.eventId })
    .from(events)
    .where(and(eq(events.entityId, conversationId), eq(events.type, type)))
    .orderBy(asc(events.occurredAt), asc(events.id))
  const jobs: ClaimedJob[] = []
  for (const { eventId } of written) {
    const [row] = getExecuteRows<{
      job_id: string
      payload: Record<string, unknown>
      max_attempts: number
    }>(
      await testDb.execute(sql`
        SELECT job_id, payload, max_attempts FROM job_queue
        WHERE queue = ${EVENT_REACTIONS_QUEUE} AND payload->>'eventId' = ${eventId}
      `)
    )
    jobs.push({
      id: '1',
      jobId: row.job_id,
      queue: EVENT_REACTIONS_QUEUE,
      dedupeKey: `${EVENT_REACTIONS_QUEUE}:${eventId}`,
      payload: row.payload,
      workspaceKey: null,
      attempts: 1,
      maxAttempts: row.max_attempts,
      leaseToken: 'test',
      lockedUntil: new Date(),
      runAt: new Date(),
    })
  }
  return jobs
}

async function firstResponseAt(ticketId: TicketId): Promise<Date | null> {
  const [row] = await testDb
    .select({ at: tickets.firstResponseAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row.at
}

describe('the ticket-first-response reaction', () => {
  it('is registered on the reaction queue and has a handler', async () => {
    expect(EVENT_REACTIONS[EVENT_REACTIONS_QUEUE]['ticket-first-response']).toEqual([
      'message.created',
      'message.deleted',
    ])
    // runReactionJob looks the reaction up by name; a missing handler would
    // make the call below throw "runs[name] is not a function".
    const source = readFileSync(path.resolve(__dirname, '../event-reactions-queue.ts'), 'utf8')
    expect(source).toMatch(/'ticket-first-response': \(event\) =>/)
  })
})

describe.skipIf(!fixture.available)('ticket first response on an intake pair', () => {
  beforeEach(fixture.begin)
  beforeEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)

  it("is set by the reaction to a teammate's redirected reply, in any order, any number of times", async () => {
    const { ticketId, conversationId, agent } = await intake()
    const { message } = await sendTicketMessage(agentActor(agent), {
      ticketId,
      content: 'Looking into it now.',
    })
    expect(message.conversationId).toBe(conversationId)
    // The reply itself writes nothing on the ticket; the reaction does.
    expect(await firstResponseAt(ticketId)).toBeNull()

    const jobs = await reactionJobs(conversationId, 'message.created', 2)
    expect(jobs).toHaveLength(2)
    // The reply's job first, then the opening's, then the reply's again.
    await runEventReactions(jobs[1])
    expect((await firstResponseAt(ticketId))?.toISOString()).toBe(message.createdAt)
    await runEventReactions(jobs[0])
    await runEventReactions(jobs[1])
    expect((await firstResponseAt(ticketId))?.toISOString()).toBe(message.createdAt)
    expect(realtime.publishTicketEvent).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({ kind: 'ticket_updated' })
    )
  })

  it('the opening alone gives no first response', async () => {
    const { ticketId, conversationId } = await intake()
    for (const job of await reactionJobs(conversationId, 'message.created', 1)) {
      await runEventReactions(job)
    }
    expect(await firstResponseAt(ticketId)).toBeNull()
  })

  it('is cleared by the reaction to the deletion of the only reply', async () => {
    const { ticketId, conversationId, agent } = await intake()
    const actor = agentActor(agent)
    const { message } = await sendTicketMessage(actor, { ticketId, content: 'On it.' })
    for (const job of await reactionJobs(conversationId, 'message.created', 2)) {
      await runEventReactions(job)
    }
    expect(await firstResponseAt(ticketId)).not.toBeNull()

    await deleteConversationMessage(message.id, actor)
    const deleted = await reactionJobs(conversationId, 'message.deleted', 1)
    expect(deleted).toHaveLength(1)
    await runEventReactions(deleted[0])
    expect(await firstResponseAt(ticketId)).toBeNull()
  })

  it('a ticket-thread reply deleted through deleteConversationMessage moves the value, with no event', async () => {
    await seedDefaultStatus()
    const requester = await seedPrincipal('user')
    const agent = await seedPrincipal('member')
    const actor = agentActor(agent)
    // A standalone customer ticket: its thread is its own.
    const [status] = await testDb
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(eq(ticketStatuses.isDefault, true))
    const [ticket] = await testDb
      .insert(tickets)
      .values({ title: 'Standalone', statusId: status.id, requesterPrincipalId: requester })
      .returning({ id: tickets.id })
    const ticketId = ticket.id as TicketId
    await testDb.insert(conversationMessages).values({
      ticketId,
      principalId: requester,
      senderType: 'visitor',
      content: 'help please',
      createdAt: new Date(Date.now() - 3_600_000),
    })
    const { message } = await sendTicketMessage(actor, { ticketId, content: 'On it.' })
    expect((await firstResponseAt(ticketId))?.toISOString()).toBe(message.createdAt)

    await deleteConversationMessage(message.id, actor)
    expect(await firstResponseAt(ticketId)).toBeNull()
  })
})
