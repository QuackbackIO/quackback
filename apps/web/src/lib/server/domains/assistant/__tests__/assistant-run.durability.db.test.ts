/**
 * Durability and concurrency proofs for the durable Quinn turn.
 *
 * Real PostgreSQL, committed transactions, independent connections, and the
 * REAL queue lease. Nothing here mocks a claim, a lease token or a reaper
 * result: every one of those is the mechanism under test, and a double that
 * returns the answer the assertion wants would pass against broken and fixed
 * code alike.
 *
 * What IS mocked is the realtime fan-out and the notification side of the
 * conversation domain, because neither participates in the transaction and
 * both need a live pub/sub connection. The database writes are all real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY = 'assistant-run-durability-secret-at-least-32-chars'

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.notify', () => ({
  notifyAgentReply: vi.fn(async () => {}),
  notifyVisitorMessage: vi.fn(),
  notifyConversationStarted: vi.fn(),
}))

// The lint rule reserves @quackback/db/client for db.ts; a fixture that needs
// its own independent connection is a sanctioned caller, like db-test-fixture.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql, type Database } from '@quackback/db/client'
import {
  db,
  conversations,
  conversationMessages,
  assistantRuns,
  assistantInvolvements,
  principal,
  and,
  eq,
  inArray,
  sql,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  claimById,
  completeJob,
  reapExpiredLeases,
  type ClaimedJob,
} from '@/lib/server/jobs/job-queue'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import {
  requestAssistantTurn,
  commitAssistantOutcome,
  invalidateAssistantWork,
  customerMessageTriggerKey,
  getAssistantRevision,
  ASSISTANT_TURN_QUEUE,
} from '../assistant-run.service'
import { claimRunForExecution, loadRun } from '../assistant-run.repository'

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
const secondClient = postgres(URL, { max: 2, onnotice: () => {} })
const second: Database = createDbFromSql(secondClient)

const available = await db.execute(sql`SELECT to_regclass('public.assistant_runs') AS t`).then(
  (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
  () => false
)

let visitorId: PrincipalId
let quinnId: PrincipalId
const createdConversations: ConversationId[] = []

async function newConversation(): Promise<ConversationId> {
  const [row] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: visitorId,
      channel: 'messenger',
      source: 'widget',
      status: 'open',
      subject: 'durable run fixture',
    })
    .returning()
  createdConversations.push(row.id)
  return row.id
}

async function customerMessage(conversationId: ConversationId): Promise<ConversationMessageId> {
  const [row] = await db
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: visitorId,
      senderType: 'visitor',
      content: 'is my order shipped?',
    })
    .returning()
  return row.id
}

/** Intake exactly as sendVisitorMessage does it: message and run in one commit. */
async function intake(
  conversationId: ConversationId
): Promise<{ messageId: ConversationMessageId; runId: string; revision: number }> {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId,
        principalId: visitorId,
        senderType: 'visitor',
        content: 'is my order shipped?',
      })
      .returning()
    const requested = await requestAssistantTurn(tx, {
      conversationId,
      triggerKey: customerMessageTriggerKey(conversationId, message.id),
      triggerKind: 'customer_message',
      surface: 'widget',
      triggerMessageId: message.id,
      requestedByPrincipalId: visitorId,
    })
    return { messageId: message.id, runId: requested.run.id, revision: requested.inputRevision }
  })
}

async function jobRowsFor(runId: string) {
  return getExecuteRows<{ job_id: string; status: string; attempts: number }>(
    await db.execute(sql`
      SELECT job_id, status, attempts FROM job_queue
      WHERE queue = ${ASSISTANT_TURN_QUEUE} AND dedupe_key = ${`assistant-turn:${runId}`}
    `)
  )
}

/**
 * Drop this suite's queue rows.
 *
 * `claimById` refuses a row that has an older runnable predecessor on the same
 * queue, because the poller is FIFO. A leftover pending row from an earlier
 * case would therefore make the NEXT case unclaimable for reasons that have
 * nothing to do with what it is testing, so each case leaves the queue empty.
 * Orphans from an earlier aborted run go too: their runs were cascade-deleted
 * with the conversation, so nothing will ever claim them.
 */
async function clearTurnJobs(): Promise<void> {
  if (createdConversations.length === 0) return
  const mine = await db
    .select({ id: assistantRuns.id })
    .from(assistantRuns)
    .where(inArray(assistantRuns.conversationId, createdConversations))
  for (const run of mine) {
    await db.execute(sql`
      DELETE FROM job_queue
      WHERE queue = ${ASSISTANT_TURN_QUEUE} AND dedupe_key = ${`assistant-turn:${run.id}`}
    `)
  }
}

/** Claim the real queue row, then take execution ownership of the run with its token. */
async function claimTurn(runId: string): Promise<ClaimedJob> {
  const [row] = await jobRowsFor(runId)
  expect(row, 'the intake commit must leave a claimable job').toBeTruthy()
  const job = await claimById(row.job_id, 60_000)
  expect(job, 'the queue row must be claimable').toBeTruthy()
  const claim = await claimRunForExecution({
    runId: runId as Parameters<typeof claimRunForExecution>[0]['runId'],
    jobId: job!.jobId,
    leaseToken: job!.leaseToken,
  })
  expect(claim.kind).toBe('claimed')
  return job!
}

const candidate = {
  text: 'Your order shipped on Tuesday.',
  responseKind: 'answer' as const,
  outcome: 'answer' as const,
  citations: [],
  handoff: null,
}

async function publish(
  runId: string,
  job: ClaimedJob,
  conversationId: ConversationId,
  exec: typeof db | Database = db
) {
  const run = await loadRun(db, runId as Parameters<typeof loadRun>[1])
  return exec.transaction((tx) =>
    commitAssistantOutcome(tx, {
      runId: run!.id,
      conversationId,
      expectedInputRevision: run!.inputRevision,
      expectedStateVersion: run!.stateVersion,
      jobLeaseToken: job.leaseToken,
      author: { principalId: quinnId, displayName: 'Quinn' },
      candidate,
    })
  )
}

async function publicMessages(conversationId: ConversationId) {
  return db
    .select({ id: conversationMessages.id, runId: conversationMessages.assistantRunId })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'agent'),
        eq(conversationMessages.isInternal, false)
      )
    )
}

describe.skipIf(!available)('durable Quinn turns on real PostgreSQL', () => {
  beforeAll(async () => {
    const [visitor] = await db
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    visitorId = visitor.id
    const [quinn] = await db
      .insert(principal)
      .values({
        role: 'member',
        type: 'service',
        displayName: 'Quinn',
        // Migration 0284's inactivity trigger identifies Quinn by exactly this
        // marker, so the fixture provisions the principal the same way
        // ensureAssistantPrincipal does. Without it the answer clock would
        // silently never move and this suite would prove nothing about it.
        serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
        createdAt: new Date(),
      })
      .returning()
    quinnId = quinn.id
    // No worker runs against the test database, so every `assistant-turn` row
    // in it was left by an earlier run of this suite. They matter because
    // `claimById` is FIFO per queue: one stale pending row makes every later
    // case unclaimable for a reason that has nothing to do with what it tests.
    await db.execute(sql`DELETE FROM job_queue WHERE queue = ${ASSISTANT_TURN_QUEUE}`)
  })

  afterEach(async () => {
    await clearTurnJobs()
  })

  afterAll(async () => {
    await clearTurnJobs()
    for (const id of createdConversations) {
      await db.delete(conversations).where(eq(conversations.id, id))
    }
    if (quinnId) await db.delete(principal).where(eq(principal.id, quinnId))
    if (visitorId) await db.delete(principal).where(eq(principal.id, visitorId))
    await secondClient.end({ timeout: 5 }).catch(() => {})
  })

  it('rolls the run and its job back with the message when intake fails', async () => {
    const conversationId = await newConversation()
    const before = await getAssistantRevision(conversationId)
    await expect(
      db.transaction(async (tx) => {
        const [message] = await tx
          .insert(conversationMessages)
          .values({
            conversationId,
            principalId: visitorId,
            senderType: 'visitor',
            content: 'rolled back',
          })
          .returning()
        await requestAssistantTurn(tx, {
          conversationId,
          triggerKey: customerMessageTriggerKey(conversationId, message.id),
          triggerKind: 'customer_message',
          surface: 'widget',
          triggerMessageId: message.id,
        })
        throw new Error('intake failed after the run was written')
      })
    ).rejects.toThrow('intake failed')

    const runs = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(runs).toHaveLength(0)
    const jobs = getExecuteRows(
      await db.execute(
        sql`SELECT job_id FROM job_queue WHERE queue = ${ASSISTANT_TURN_QUEUE}
            AND payload->>'conversationId' = ${conversationId}`
      )
    )
    expect(jobs).toHaveLength(0)
    // The counter is part of the same transaction, so it did not move either.
    expect(await getAssistantRevision(conversationId)).toBe(before)
  })

  it('leaves a claimable job when the process dies right after the intake commit', async () => {
    const conversationId = await newConversation()
    const { runId } = await intake(conversationId)

    const run = await loadRun(db, runId as Parameters<typeof loadRun>[1])
    expect(run?.status).toBe('queued')
    const [job] = await jobRowsFor(runId)
    expect(job?.status).toBe('pending')

    // A fresh process claims it and produces exactly one outcome.
    const claimed = await claimTurn(runId)
    const outcome = await publish(runId, claimed, conversationId)
    expect(outcome.kind).toBe('published')
    expect(await publicMessages(conversationId)).toHaveLength(1)
  })

  it('recognises a committed outcome on replay without a second message or event', async () => {
    const conversationId = await newConversation()
    const { runId } = await intake(conversationId)
    const job = await claimTurn(runId)

    const first = await publish(runId, job, conversationId)
    expect(first.kind).toBe('published')
    const eventsAfterFirst = getExecuteRows(
      await db.execute(
        sql`SELECT event_id FROM events WHERE entity_id = ${conversationId}
            AND type = 'message.created'`
      )
    )

    // The job was never completed, so the queue re-delivers it. The replay must
    // recognise the committed outcome and finish harmlessly.
    const replay = await publish(runId, job, conversationId)
    expect(replay.kind).toBe('already_published')
    expect(await publicMessages(conversationId)).toHaveLength(1)
    const eventsAfterReplay = getExecuteRows(
      await db.execute(
        sql`SELECT event_id FROM events WHERE entity_id = ${conversationId}
            AND type = 'message.created'`
      )
    )
    expect(eventsAfterReplay.length).toBe(eventsAfterFirst.length)
  })

  it('lets only one of two queued turns publish, and supersedes the other', async () => {
    const conversationId = await newConversation()
    const first = await intake(conversationId)
    const secondTurn = await intake(conversationId)

    // The older turn's worker wakes up first and claims its own queue row,
    // which is the head of this FIFO. It must not take execution ownership.
    const [olderRow] = await jobRowsFor(first.runId)
    const olderJob = await claimById(olderRow.job_id, 60_000)
    expect(olderJob).toBeTruthy()
    const staleClaim = await claimRunForExecution({
      runId: first.runId as Parameters<typeof claimRunForExecution>[0]['runId'],
      jobId: olderJob!.jobId,
      leaseToken: olderJob!.leaseToken,
    })
    expect(staleClaim.kind).not.toBe('claimed')
    await completeJob(olderJob!)

    const job = await claimTurn(secondTurn.runId)
    const outcome = await publish(secondTurn.runId, job, conversationId, second)
    expect(outcome.kind).toBe('published')

    const rows = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(rows.filter((r) => r.status === 'succeeded')).toHaveLength(1)
    expect(rows.filter((r) => r.status === 'superseded')).toHaveLength(1)
    expect(await publicMessages(conversationId)).toHaveLength(1)
  })

  it('rejects a worker whose lease the reaper already took', async () => {
    const conversationId = await newConversation()
    const { runId } = await intake(conversationId)
    const job = await claimTurn(runId)

    // Real expiry, real reaper. The turn job is at-most-once, so the reaper
    // makes it terminal rather than handing it to a new owner — which is
    // exactly the case a run-row token comparison alone would miss.
    await db.execute(
      sql`UPDATE job_queue SET locked_until = now() - interval '1 second' WHERE job_id = ${job.jobId}`
    )
    const reaped = await reapExpiredLeases()
    expect(reaped.terminated).toBeGreaterThanOrEqual(1)

    const outcome = await publish(runId, job, conversationId)
    expect(outcome).toEqual({ kind: 'rejected', reason: 'fence:lease_token' })
    expect(await publicMessages(conversationId)).toHaveLength(0)
  })

  it('stops an older turn publishing once a newer customer message arrives', async () => {
    const conversationId = await newConversation()
    const older = await intake(conversationId)
    const job = await claimTurn(older.runId)

    // B arrives while A is generating, on an independent connection.
    // (A's queue row is already claimed, so B's is the head of the FIFO.)
    const newer = await second.transaction(async (tx) => {
      const [message] = await tx
        .insert(conversationMessages)
        .values({
          conversationId,
          principalId: visitorId,
          senderType: 'visitor',
          content: 'actually, where is it now?',
        })
        .returning()
      return requestAssistantTurn(tx, {
        conversationId,
        triggerKey: customerMessageTriggerKey(conversationId, message.id),
        triggerKind: 'customer_message',
        surface: 'widget',
        triggerMessageId: message.id,
      })
    })

    const stale = await publish(older.runId, job, conversationId)
    expect(stale).toEqual({ kind: 'rejected', reason: 'fence:input_revision' })
    expect(await publicMessages(conversationId)).toHaveLength(0)

    // B answers over the newest context.
    const newerJob = await claimTurn(newer.run.id)
    expect((await publish(newer.run.id, newerJob, conversationId)).kind).toBe('published')
    const published = await publicMessages(conversationId)
    expect(published).toHaveLength(1)
    expect(published[0].runId).toBe(newer.run.id)
  })

  it('stops a late reply after a takeover, a close, a snooze and a spam filing', async () => {
    for (const reason of ['human_reply', 'takeover', 'close', 'snooze', 'spam'] as const) {
      const conversationId = await newConversation()
      const { runId } = await intake(conversationId)
      const job = await claimTurn(runId)

      // The invalidation every one of those transitions performs, on an
      // independent connection, while this turn is generating.
      await invalidateAssistantWork(second, conversationId, reason)

      const outcome = await publish(runId, job, conversationId)
      expect(outcome, reason).toEqual({ kind: 'rejected', reason: 'fence:input_revision' })
      expect(await publicMessages(conversationId), reason).toHaveLength(0)
    }
  })

  it('refuses to publish into a closed or snoozed conversation even without a bump', async () => {
    for (const status of ['closed', 'snoozed'] as const) {
      const conversationId = await newConversation()
      const { runId } = await intake(conversationId)
      const job = await claimTurn(runId)

      // Deliberately NOT through the lifecycle service: this proves the
      // belt-and-braces state check stands on its own, so a future transition
      // that forgets the counter still cannot produce a reply into a dead thread.
      await second.update(conversations).set({ status }).where(eq(conversations.id, conversationId))

      const outcome = await publish(runId, job, conversationId)
      expect(outcome, status).toEqual({
        kind: 'rejected',
        reason: status === 'closed' ? 'fence:conversation_closed' : 'fence:conversation_snoozed',
      })
      expect(await publicMessages(conversationId), status).toHaveLength(0)
    }
  })

  it('keeps one active involvement when two turns answer the same conversation', async () => {
    const conversationId = await newConversation()
    const first = await intake(conversationId)
    const job = await claimTurn(first.runId)
    expect((await publish(first.runId, job, conversationId)).kind).toBe('published')

    const next = await intake(conversationId)
    const nextJob = await claimTurn(next.runId)
    expect((await publish(next.runId, nextJob, conversationId, second)).kind).toBe('published')

    const active = await db
      .select()
      .from(assistantInvolvements)
      .where(
        and(
          eq(assistantInvolvements.conversationId, conversationId),
          eq(assistantInvolvements.status, 'active')
        )
      )
    expect(active).toHaveLength(1)
    expect(await publicMessages(conversationId)).toHaveLength(2)
  })

  it('refuses a second terminal message for one run at the database level', async () => {
    const conversationId = await newConversation()
    const { runId } = await intake(conversationId)
    const job = await claimTurn(runId)
    expect((await publish(runId, job, conversationId)).kind).toBe('published')

    // The partial unique index is the backstop under every service-level check.
    await expect(
      db.insert(conversationMessages).values({
        conversationId,
        principalId: quinnId,
        senderType: 'agent',
        content: 'a second terminal message',
        assistantRunId: runId as never,
      })
    ).rejects.toThrow()
  })

  it('stamps the answer clock and the assistant inactivity owner in the same commit', async () => {
    const conversationId = await newConversation()
    await customerMessage(conversationId)
    const { runId } = await intake(conversationId)
    const job = await claimTurn(runId)
    expect((await publish(runId, job, conversationId)).kind).toBe('published')

    const [row] = await db
      .select({
        owner: conversations.inactivityOwner,
        anchor: conversations.inactivityAnchorAt,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(row.owner).toBe('assistant_answered')
    expect(row.anchor).not.toBeNull()

    const [involvement] = await db
      .select()
      .from(assistantInvolvements)
      .where(eq(assistantInvolvements.conversationId, conversationId))
    expect(involvement.lastAssistantAnswerAt).not.toBeNull()
  })
})
