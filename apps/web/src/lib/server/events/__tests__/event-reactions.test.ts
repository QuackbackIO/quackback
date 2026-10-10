/**
 * The event reactions run from durable jobs that `emit()` queues in the
 * event's own transaction, whichever path produced the event:
 *
 * - `event-reactions` runs the reactions that read earlier state (SLA clocks,
 *   pair-ticket reopen, CSAT confirm), one job at a time per worker process in
 *   enqueue order. What happens when that order breaks is covered by
 *   event-reactions-sla-order.test.ts.
 * - `event-summaries` runs the close summaries, slow AI calls that do not
 *   depend on order, off that serial queue.
 *
 * Both jobs exist the moment the event commits, before and apart from the
 * event-dispatch drain, so a failing target resolver or a crash after publish
 * cannot lose them. A native `emit()` producer (here the integration status
 * sync) and a legacy `dispatch*()` producer both get their reactions from the
 * jobs, and neither `processEvent` nor the drain runs them a second time.
 *
 * Real DB (rolled back per test), real producers, outbox, drain, job runner
 * and handlers. Only the five reaction entry points are mocked, so every call
 * below is recorded with the arguments it received.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type TicketId, type TicketStatusId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { events, eq, principal, sql, tickets, ticketStatuses } from '@/lib/server/db'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type {
  EventActor,
  EventConversationRef,
  EventData,
  EventMessageData,
  EventTicketRef,
} from '../types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const reactions = vi.hoisted(() => ({
  recordSlaFromEvent: vi.fn(async (_event: unknown) => {}),
  autoReopenPairTicketFromEvent: vi.fn(async (_event: unknown) => {}),
  confirmResolutionFromCsat: vi.fn(
    async (_conversationId: unknown, _rating: unknown, _submittedAt: unknown) => {}
  ),
  summarizeConversationOnClose: vi.fn(
    async (_conversationId: unknown, _close: unknown, _opts?: unknown) => {}
  ),
  summarizeTicketOnClose: vi.fn(async (_ticketId: unknown, _close: unknown, _opts?: unknown) => {}),
}))

vi.mock('@/lib/server/domains/sla/sla.event-hooks', () => ({
  recordSlaFromEvent: reactions.recordSlaFromEvent,
}))
vi.mock('@/lib/server/domains/tickets/ticket.event-hooks', () => ({
  autoReopenPairTicketFromEvent: reactions.autoReopenPairTicketFromEvent,
}))
vi.mock('@/lib/server/domains/assistant/assistant.involvement', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/assistant/assistant.involvement')
  >()),
  confirmResolutionFromCsat: reactions.confirmResolutionFromCsat,
}))
vi.mock('@/lib/server/domains/assistant/conversation-summary.service', () => ({
  summarizeConversationOnClose: reactions.summarizeConversationOnClose,
}))
vi.mock('@/lib/server/domains/assistant/ticket-summary.service', () => ({
  summarizeTicketOnClose: reactions.summarizeTicketOnClose,
}))

import {
  EVENT_REACTIONS_QUEUE,
  EVENT_SUMMARIES_QUEUE,
  REACTION_DEADLINE_MS,
} from '../event-reactions'
import { runEventReactions } from '../event-reactions-queue'
import { runEventSummaries } from '../event-summaries-queue'
import { runEventDispatch } from '../event-dispatch-queue'
import * as dispatch from '../dispatch'
import { applySyncedTicketStatus } from '@/lib/server/domains/tickets/ticket-status-sync'
import { privateReactionQueue } from './private-reaction-queue'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ owner: events.dispatchOwner }).from(events).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})
afterAll(() => fixture.close())

type ReactionName = keyof typeof reactions
const REACTION_NAMES = Object.keys(reactions) as ReactionName[]

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const eventRowsFor = (entityId: string) =>
  testDb.select().from(events).where(eq(events.entityId, entityId)).orderBy(events.id)

/** The pending reaction jobs `emit()` queued for one event, as the worker would claim them. */
async function reactionJobsFor(eventId: string): Promise<ClaimedJob[]> {
  const result = await testDb.execute(sql`
    SELECT job_id, queue, dedupe_key, payload, max_attempts, run_at FROM job_queue
    WHERE queue IN (${EVENT_REACTIONS_QUEUE}, ${EVENT_SUMMARIES_QUEUE})
      AND payload->>'eventId' = ${eventId} AND status = 'pending'
    ORDER BY queue
  `)
  return getExecuteRows<{
    job_id: string
    queue: string
    dedupe_key: string | null
    payload: Record<string, unknown>
    max_attempts: number
    run_at: string
  }>(result).map((row) => ({
    id: '1',
    jobId: row.job_id,
    queue: row.queue,
    dedupeKey: row.dedupe_key,
    payload: row.payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: row.max_attempts,
    leaseToken: 'test',
    lockedUntil: new Date(),
    runAt: new Date(row.run_at),
  }))
}

/** Run one reaction job through its queue's handler. */
const runReactionJob = (job: ClaimedJob) =>
  job.queue === EVENT_REACTIONS_QUEUE ? runEventReactions(job) : runEventSummaries(job)

/** One event-dispatch run, as the worker would make it. */
function drain(eventId: string, resolve: () => Promise<[]> = async () => []) {
  const job: ClaimedJob = {
    id: '1',
    jobId: createId('job'),
    queue: 'event-dispatch',
    dedupeKey: `event-dispatch:${eventId}`,
    payload: { eventId },
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 10,
    leaseToken: 'test',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
  return runEventDispatch(job, { resolve })
}

/** Long enough for any fire-and-forget straggler to land before counting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

const eventsSeenBySla = () =>
  reactions.recordSlaFromEvent.mock.calls.map(([event]) => event as EventData)

/** Each reaction in `expected` ran exactly once with its arguments; every other one never ran. */
function expectReacted(
  expected: Partial<Record<ReactionName, (entityId: string) => unknown[]>>,
  entityId: string
) {
  for (const name of REACTION_NAMES) {
    const args = expected[name]
    if (args) {
      expect(reactions[name], name).toHaveBeenCalledTimes(1)
      expect(reactions[name], name).toHaveBeenCalledWith(...args(entityId))
    } else {
      expect(reactions[name], name).not.toHaveBeenCalled()
    }
  }
}

async function seedTicket() {
  const [open, closed] = await testDb
    .insert(ticketStatuses)
    .values([
      { name: `Open ${suffix()}`, slug: `open_${suffix()}`, category: 'open' },
      { name: `Done ${suffix()}`, slug: `done_${suffix()}`, category: 'closed' },
    ])
    .returning()
  const [service] = await testDb
    .insert(principal)
    .values({ type: 'service', role: 'member', displayName: 'Tracker', createdAt: new Date() })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ type: 'customer', title: `Ticket ${suffix()}`, statusId: open.id as TicketStatusId })
    .returning()
  return {
    ticketId: ticket.id as TicketId,
    closedStatusId: closed.id as TicketStatusId,
    principalId: service.id as PrincipalId,
  }
}

/** Close the ticket through the integration inbound sync, a native `emit()` producer. */
async function closeBySync() {
  const { ticketId, closedStatusId, principalId } = await seedTicket()
  await testDb.transaction((tx) =>
    applySyncedTicketStatus(tx, ticketId, closedStatusId, principalId, {
      integrationType: 'linear',
      externalDisplayId: 'ENG-1',
      externalUrl: null,
      externalStatus: 'Done',
      transition: 'closed',
      deliveryKey: `delivery_${suffix()}`,
    })
  )
  const rows = await eventRowsFor(ticketId)
  const statusRow = rows.find((row) => row.type === 'ticket.status_changed')
  if (!statusRow) throw new Error('status sync wrote no ticket.status_changed event')
  return { ticketId, rows, statusRow }
}

const actor = (): EventActor => ({
  type: 'user',
  principalId: createId('principal'),
  userId: createId('user'),
  email: 'agent@example.com',
  displayName: 'Agent Smith',
})
const convRef = (): EventConversationRef => ({
  id: createId('conversation'),
  status: 'open',
  channel: 'messenger',
  priority: 'medium',
  assignedTeamId: null,
})
const ticketRef = (): EventTicketRef => ({
  id: createId('ticket'),
  number: 42,
  type: 'customer',
  priority: 'high',
  assignedPrincipalId: null,
  assignedTeamId: null,
})
const messageIn = (
  conversation: EventConversationRef,
  senderType: 'visitor' | 'agent'
): EventMessageData => ({
  id: createId('conversation_message'),
  conversationId: conversation.id,
  senderType,
  authorPrincipalId: createId('principal'),
  authorName: senderType,
  authorEmail: `${senderType}@example.com`,
  content: `From the ${senderType}`,
  createdAt: new Date().toISOString(),
})

const slaSaw = (type: EventData['type']) => () => [expect.objectContaining({ type })]
/**
 * A summary gets the close that queued it (the job's own event) and the job's
 * abort signal, so a deadline can cancel its AI calls.
 */
const summaryOf = (id: string) => [
  id,
  { eventId: expect.any(String), at: expect.any(Date) },
  { signal: expect.any(AbortSignal) },
]
const ticketClosedReactions = {
  recordSlaFromEvent: slaSaw('ticket.status_changed'),
  summarizeTicketOnClose: summaryOf,
}

describe.skipIf(!fixture.available)('event reactions (real DB, rolled back)', () => {
  beforeEach(() => {
    for (const name of REACTION_NAMES) reactions[name].mockReset()
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  it('a ticket closed by integration status sync commits its reaction jobs with the event', async () => {
    const { ticketId, rows, statusRow } = await closeBySync()

    // Queued in the event's transaction: there before any drain has run.
    expect(statusRow.publishedAt).toBeNull()
    for (const row of rows) {
      if (row.type === 'ticket.status_changed') continue
      expect(await reactionJobsFor(row.eventId), row.type).toEqual([])
    }
    const [ordered, summaries] = await reactionJobsFor(statusRow.eventId)
    expect(ordered.dedupeKey).toBe(`${EVENT_REACTIONS_QUEUE}:${statusRow.eventId}`)
    expect(summaries.dedupeKey).toBe(`${EVENT_SUMMARIES_QUEUE}:${statusRow.eventId}`)
    expect(ordered.maxAttempts).toBeGreaterThan(1)
    expect(summaries.maxAttempts).toBeGreaterThan(1)

    // The ordered job settles the clock and never waits on the AI summary.
    await runEventReactions(ordered)
    expectReacted({ recordSlaFromEvent: ticketClosedReactions.recordSlaFromEvent }, ticketId)
    expect(eventsSeenBySla()[0]).toMatchObject({
      type: 'ticket.status_changed',
      data: { ticket: { id: ticketId }, previousStatus: 'open', newStatus: 'closed' },
    })
    // The SLA clock settles at the event's own time, so it must be a real instant.
    expect(Number.isNaN(new Date(eventsSeenBySla()[0].timestamp).getTime())).toBe(false)

    await runEventSummaries(summaries)
    expectReacted(ticketClosedReactions, ticketId)
    // Bound to the close that queued it: the status event's id and time.
    expect(reactions.summarizeTicketOnClose.mock.calls[0][1]).toEqual({
      eventId: statusRow.eventId,
      at: statusRow.occurredAt,
    })
  })

  it('a failing target resolver does not hold the reactions back, and publishing does not spend them', async () => {
    const { ticketId, statusRow } = await closeBySync()

    // Outbound delivery fails and retries: the event stays unpublished.
    await expect(
      drain(statusRow.eventId, async () => {
        throw new Error('webhook target lookup down')
      })
    ).rejects.toThrow('webhook target lookup down')
    // Then it publishes. Neither drain run reacts.
    await drain(statusRow.eventId)
    const [published] = await testDb.select().from(events).where(eq(events.id, statusRow.id))
    expect(published.publishedAt).not.toBeNull()
    await settle()
    expectReacted({}, ticketId)

    // A worker that dies after the publish leaves these jobs pending, so the
    // reactions still run.
    const jobs = await reactionJobsFor(statusRow.eventId)
    expect(jobs.map((job) => job.queue)).toEqual([EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE])
    for (const job of jobs) await runReactionJob(job)
    expectReacted(ticketClosedReactions, ticketId)
  })

  it("a drain of the test's own jobs never claims or changes another suite's row", async () => {
    // A row another suite queued on the shipped queue, older than this test's
    // jobs, so a drain of the shipped queue would claim it first.
    const foreignEventId = createId('event')
    await enqueueJob({
      queue: EVENT_REACTIONS_QUEUE,
      payload: { eventId: foreignEventId },
      runAt: new Date(Date.now() - 60 * 60_000),
      maxAttempts: 3,
    })
    const foreignRow = async () =>
      getExecuteRows<{ queue: string; status: string; attempts: number; run_at: string }>(
        await testDb.execute(sql`
          SELECT queue, status, attempts, run_at FROM job_queue
          WHERE payload->>'eventId' = ${foreignEventId}
        `)
      )
    const before = await foreignRow()
    const conversation = convRef()
    await dispatch.dispatchMessageCreated(
      actor(),
      messageIn(conversation, 'visitor'),
      conversation,
      true
    )
    const ours = (await eventRowsFor(conversation.id)).map((row) => row.eventId)

    const queue = privateReactionQueue()
    try {
      await queue.adopt(ours)
      expect(await queue.drain()).toMatchObject({ claimed: 1, succeeded: 1 })
      expect(await queue.drain()).toMatchObject({ claimed: 0 })
    } finally {
      queue.release()
    }

    expect(await foreignRow()).toEqual(before)
    expect(before).toMatchObject([{ queue: EVENT_REACTIONS_QUEUE, status: 'pending', attempts: 0 }])
    expect(eventsSeenBySla().map((event) => event.data)).toEqual([
      expect.objectContaining({ conversation: expect.objectContaining({ id: conversation.id }) }),
    ])
  })

  it("within one worker process, runs one event's reactions to completion before the next, in enqueue order", async () => {
    const conversation = convRef()
    const visitor = messageIn(conversation, 'visitor')
    const reply = messageIn(conversation, 'agent')
    await dispatch.dispatchMessageCreated(actor(), visitor, conversation, true)
    await dispatch.dispatchMessageCreated(actor(), reply, conversation, false)

    const steps: string[] = []
    reactions.recordSlaFromEvent.mockImplementation(async (event) => {
      const { message } = (event as { data: { message?: EventMessageData } }).data
      if (message?.conversationId !== conversation.id) return
      steps.push(`start ${message.senderType}`)
      // The visitor message re-arms the clock the reply then settles. Make it
      // the slow one, so a concurrent runner would let the reply overtake it.
      if (message.senderType === 'visitor') await new Promise((r) => setTimeout(r, 100))
      steps.push(`end ${message.senderType}`)
    })

    const ours = (await eventRowsFor(conversation.id)).map((row) => row.eventId)
    expect(ours).toHaveLength(2)

    // The real runner and the shipped definition, as the worker would drain
    // it, over this test's own jobs only (private-reaction-queue.ts).
    const queue = privateReactionQueue()
    try {
      await queue.adopt(ours)
      for (let pass = 0; pass < 10; pass++) {
        if ((await queue.drain()).claimed === 0) break
      }
    } finally {
      queue.release()
    }

    expect(steps).toEqual(['start visitor', 'end visitor', 'start agent', 'end agent'])
  })

  it(
    'a reaction that never settles fails its job at the deadline, and the next event runs',
    { timeout: 10_000 },
    async () => {
      const stuck = convRef()
      const next = convRef()
      await dispatch.dispatchMessageCreated(actor(), messageIn(stuck, 'visitor'), stuck, true)
      await dispatch.dispatchMessageCreated(actor(), messageIn(next, 'visitor'), next, true)
      const [stuckRow] = await eventRowsFor(stuck.id)
      const [nextRow] = await eventRowsFor(next.id)

      // The first event's SLA reaction waits on something that never answers,
      // such as a row lock nobody releases.
      reactions.recordSlaFromEvent.mockImplementation((event) => {
        const { message } = (event as { data: { message?: EventMessageData } }).data
        return message?.conversationId === stuck.id ? new Promise(() => {}) : Promise.resolve()
      })

      const deadline = REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE]
      REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE] = 100
      // This test's own jobs only (private-reaction-queue.ts).
      const queue = privateReactionQueue()
      try {
        await queue.adopt([stuckRow.eventId, nextRow.eventId])
        // The stuck job fails at its deadline and is requeued for a retry...
        expect(await queue.drain()).toMatchObject({ claimed: 1, retrying: 1 })
        // ...which releases the lane, so the next event's reactions run.
        expect(await queue.drain()).toMatchObject({ claimed: 1, succeeded: 1 })
      } finally {
        REACTION_DEADLINE_MS[EVENT_REACTIONS_QUEUE] = deadline
        queue.release()
      }

      expect(eventsSeenBySla().map((event) => event.data)).toEqual([
        expect.objectContaining({ conversation: expect.objectContaining({ id: stuck.id }) }),
        expect.objectContaining({ conversation: expect.objectContaining({ id: next.id }) }),
      ])
      const [job] = getExecuteRows<{ status: string; attempts: number; last_error: string }>(
        await testDb.execute(sql`
          SELECT status, attempts, last_error FROM job_queue
          WHERE queue = ${queue.name} AND payload->>'eventId' = ${stuckRow.eventId}
        `)
      )
      expect(job).toMatchObject({ status: 'pending', attempts: 1 })
      expect(job.last_error).toMatch(/deadline/)
    }
  )

  it(
    'a summary still running at its deadline has its AI call aborted',
    { timeout: 5_000 },
    async () => {
      const conversation = convRef()
      await dispatch.dispatchConversationStatusChanged(actor(), conversation, 'open', 'closed')
      const [row] = await eventRowsFor(conversation.id)
      const summaries = (await reactionJobsFor(row.eventId)).find(
        (job) => job.queue === EVENT_SUMMARIES_QUEUE
      )
      let received: AbortSignal | undefined
      reactions.summarizeConversationOnClose.mockImplementation((_id, _close, opts) => {
        received = (opts as { signal?: AbortSignal } | undefined)?.signal
        return new Promise(() => {})
      })

      const deadline = REACTION_DEADLINE_MS[EVENT_SUMMARIES_QUEUE]
      REACTION_DEADLINE_MS[EVENT_SUMMARIES_QUEUE] = 50
      try {
        await expect(runEventSummaries(summaries!)).rejects.toThrow(/deadline/)
      } finally {
        REACTION_DEADLINE_MS[EVENT_SUMMARIES_QUEUE] = deadline
      }
      expect(received?.aborted).toBe(true)
    }
  )

  it('a failing reaction does not starve the others on its job, and fails the job so it retries', async () => {
    const conversation = convRef()
    await dispatch.dispatchMessageCreated(
      actor(),
      messageIn(conversation, 'visitor'),
      conversation,
      true
    )
    reactions.recordSlaFromEvent.mockImplementation(() => {
      throw new Error('sla store down')
    })

    const [row] = await eventRowsFor(conversation.id)
    const [job] = await reactionJobsFor(row.eventId)
    expect(job.queue).toBe(EVENT_REACTIONS_QUEUE)
    await expect(runEventReactions(job)).rejects.toThrow('sla store down')

    expect(reactions.recordSlaFromEvent).toHaveBeenCalledTimes(1)
    expect(reactions.autoReopenPairTicketFromEvent).toHaveBeenCalledTimes(1)
  })

  it('a job whose event row is gone is a no-op', async () => {
    await expect(
      runEventReactions({
        id: '1',
        jobId: createId('job'),
        queue: EVENT_REACTIONS_QUEUE,
        dedupeKey: null,
        payload: { eventId: createId('event') },
        workspaceKey: null,
        attempts: 1,
        maxAttempts: 3,
        leaseToken: 'test',
        lockedUntil: new Date(),
        runAt: new Date(),
      })
    ).resolves.toBeUndefined()
    expectReacted({}, '')
  })

  interface LegacyCase {
    type: EventData['type']
    /** Dispatch through the real legacy path; returns the outbox entity id. */
    run: () => Promise<string>
    /** The queues the event gets a job on. */
    queues: string[]
    /** Every reaction this event must reach, with its arguments. */
    expected: Partial<Record<ReactionName, (entityId: string) => unknown[]>>
  }

  const legacyCases: LegacyCase[] = [
    {
      type: 'ticket.status_changed',
      run: async () => {
        const ticket = ticketRef()
        await dispatch.dispatchTicketStatusChanged(
          actor(),
          ticket,
          'open',
          'closed',
          null,
          null,
          createId('principal'),
          'A ticket'
        )
        return ticket.id
      },
      queues: [EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE],
      expected: ticketClosedReactions,
    },
    {
      type: 'conversation.status_changed',
      run: async () => {
        const conversation = convRef()
        await dispatch.dispatchConversationStatusChanged(actor(), conversation, 'open', 'closed')
        return conversation.id
      },
      queues: [EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE],
      expected: {
        recordSlaFromEvent: slaSaw('conversation.status_changed'),
        summarizeConversationOnClose: summaryOf,
      },
    },
    {
      type: 'conversation.csat_submitted',
      run: async () => {
        const conversation = convRef()
        await dispatch.dispatchConversationCsatSubmitted(
          actor(),
          conversation,
          5,
          'great',
          new Date('2026-01-01').toISOString()
        )
        return conversation.id
      },
      queues: [EVENT_REACTIONS_QUEUE],
      expected: { confirmResolutionFromCsat: (id) => [id, 5, new Date('2026-01-01')] },
    },
    {
      type: 'message.created',
      run: async () => {
        const conversation = convRef()
        await dispatch.dispatchMessageCreated(
          actor(),
          messageIn(conversation, 'visitor'),
          conversation,
          true
        )
        return conversation.id
      },
      queues: [EVENT_REACTIONS_QUEUE],
      expected: {
        recordSlaFromEvent: slaSaw('message.created'),
        autoReopenPairTicketFromEvent: slaSaw('message.created'),
      },
    },
  ]

  it.each(legacyCases)(
    'a legacy-dispatched $type reacts once, from its reaction jobs',
    async ({ type, run, queues, expected }) => {
      const entityId = await run()

      // Nothing reacts in-process at dispatch time.
      await settle()
      expectReacted({}, entityId)

      const rows = await eventRowsFor(entityId)
      expect(rows.map((row) => row.type)).toEqual([type])
      const jobs = await reactionJobsFor(rows[0].eventId)
      expect(jobs.map((job) => job.queue)).toEqual(queues)
      for (const job of jobs) await runReactionJob(job)
      expectReacted(expected, entityId)

      // The drain publishes the row and does not react again.
      await drain(rows[0].eventId)
      const [row] = await eventRowsFor(entityId)
      expect(row.publishedAt).not.toBeNull()
      await settle()
      expectReacted(expected, entityId)
    }
  )
})
