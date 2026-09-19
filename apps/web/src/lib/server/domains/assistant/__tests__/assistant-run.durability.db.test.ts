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
// Two P4 cases below resume a workflow run, which rebuilds its condition
// context; this database carries no workspace settings row, and office hours
// are not what any case here is about.
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))
vi.mock('@/lib/server/domains/settings/settings.widget', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.widget')>()),
  getMessengerConfig: vi.fn(async () => ({ assistant: { respond: true } })),
}))
// The fake model, for the end-to-end executor cases at the bottom of this file.
// `runAssistantTurn` is re-exported through the domain barrel the orchestrator
// imports, so replacing it here replaces it for the real code path under test.
vi.mock('../assistant.runtime', async (original) => {
  const actual = await original<typeof import('../assistant.runtime')>()
  return { ...actual, isAssistantConfigured: () => true, runAssistantTurn: vi.fn() }
})

// The lint rule reserves @quackback/db/client for db.ts; a fixture that needs
// its own independent connection is a sanctioned caller, like db-test-fixture.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql, type Database } from '@quackback/db/client'
import {
  db,
  conversations,
  conversationMessages,
  assistantRuns,
  assistantRunSteps,
  assistantInvolvements,
  principal,
  workflows,
  workflowRuns,
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
import { runAssistantTurn } from '../assistant.runtime'
import { advanceAssistantRun } from '../assistant-run.executor'

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
const secondClient = postgres(URL, { max: 2, onnotice: () => {} })
const second: Database = createDbFromSql(secondClient)

/**
 * Opt-in on a DEDICATED database, following conversation-inactivity.db.test.ts.
 *
 * This suite commits rows rather than rolling them back, which is the whole
 * point: a lease exists so work can outlive the transaction that claimed it, so
 * a fixture that never commits cannot observe the property under test. Committed
 * conversations and messages are visible to every other suite sharing the
 * database, and several of those assert whole-table state, so this one runs
 * against `quackback_quinn_runs` and is inert anywhere else.
 */
const dedicatedDatabase = !!process.env.TEST_DATABASE_URL?.includes('quinn_runs')

const tableAvailable = dedicatedDatabase
  ? await db.execute(sql`SELECT to_regclass('public.assistant_runs') AS t`).then(
      (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
      () => false
    )
  : false
const available = dedicatedDatabase && tableAvailable

let visitorId: PrincipalId
let quinnId: PrincipalId
const createdConversations: ConversationId[] = []
const createdWorkflows: Array<typeof workflows.$inferSelect.id> = []

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
    .select({
      id: conversationMessages.id,
      runId: conversationMessages.assistantRunId,
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'agent'),
        eq(conversationMessages.isInternal, false)
      )
    )
}

// File-level fixtures: both suites below share one visitor and one Quinn
// service principal, and the second would otherwise run against rows the
// first's teardown had already removed.
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
  // Same reasoning for the fixtures themselves: a suite that aborted in this
  // hook never reached its cleanup, and its conversations would then be
  // counted by every other suite that asserts whole-table state.
  await db.delete(conversations).where(eq(conversations.subject, 'durable run fixture'))
})

afterEach(async () => {
  await clearTurnJobs()
})

afterAll(async () => {
  await clearTurnJobs()
  for (const id of createdConversations) {
    await db.delete(conversations).where(eq(conversations.id, id))
  }
  for (const id of createdWorkflows) await db.delete(workflows).where(eq(workflows.id, id))
  if (quinnId) await db.delete(principal).where(eq(principal.id, quinnId))
  if (visitorId) await db.delete(principal).where(eq(principal.id, visitorId))
  await secondClient.end({ timeout: 5 }).catch(() => {})
})

describe.skipIf(!available)('durable Quinn turns on real PostgreSQL', () => {
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

  it('P6: refuses to publish an answer citing a source revoked mid-generation', async () => {
    const conversationId = await newConversation()
    const { runId } = await intake(conversationId)
    const job = await claimTurn(runId)
    const run = await loadRun(db, runId as Parameters<typeof loadRun>[1])

    // The citation and its evidence are both real: the source was retrieved
    // while the turn was generating, and only then stopped being serveable.
    const citation = {
      type: 'article' as const,
      id: 'article_revoked',
      title: 'Refunds',
      url: '/x',
    }
    const outcome = await db.transaction((tx) =>
      commitAssistantOutcome(tx, {
        runId: run!.id,
        conversationId,
        expectedInputRevision: run!.inputRevision,
        expectedStateVersion: run!.stateVersion,
        jobLeaseToken: job.leaseToken,
        author: { principalId: quinnId, displayName: 'Quinn' },
        candidate: { ...candidate, citations: [citation] },
        evidence: [
          {
            sourceType: 'article',
            sourceId: 'article_revoked',
            passage: 'Refunds land within ten days.',
            audience: 'public',
            provenance: 'index',
            retrievalRank: 0,
          },
        ],
      })
    )
    expect(outcome).toEqual({ kind: 'rejected', reason: 'validation:revoked_evidence' })
    expect(await publicMessages(conversationId)).toHaveLength(0)

    // And the refusal is inspectable as a validator decision, not as silence.
    const [step] = await db
      .select({ validator: assistantRunSteps.validator, status: assistantRunSteps.status })
      .from(assistantRunSteps)
      .where(
        and(
          eq(assistantRunSteps.runId, runId as never),
          eq(assistantRunSteps.stepKey, 'publication_validation')
        )
      )
    expect(step.status).toBe('failed')
    expect(step.validator).toMatchObject({ layer: 'deterministic', code: 'revoked_evidence' })
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

function answer(text: string) {
  return {
    status: 'answered' as const,
    responseKind: 'answer' as const,
    text,
    answerType: 'draft_reply' as const,
    citations: [],
    internalSourced: false,
    proposedActions: [],
    identity: { name: 'Quinn', avatarUrl: null },
    // The real turn always carries these; a fake that omitted them would let
    // the executor's evidence hand-off break without any case noticing.
    evidence: [],
    retrieval: { embeddingModel: null, degradedReason: null },
    trace: {
      promptVersion: 'test',
      configRevision: 1,
      role: 'customer_support',
      appliedGuidance: [],
      toolCalls: [],
    },
  }
}

async function seedTurn(): Promise<{ conversationId: ConversationId; runId: string }> {
  const conversationId = await newConversation()
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId,
        principalId: visitorId,
        senderType: 'visitor',
        content: 'where is my order?',
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
    return { conversationId, runId: requested.run.id }
  })
}

describe.skipIf(!available)('the durable turn executor on real PostgreSQL', () => {
  afterEach(() => {
    vi.mocked(runAssistantTurn).mockReset()
  })

  it('claims, freezes the behaviour, publishes once and settles the run', async () => {
    const { conversationId, runId } = await seedTurn()
    vi.mocked(runAssistantTurn).mockResolvedValue(
      answer('Your order is on its way.') as unknown as Awaited<ReturnType<typeof runAssistantTurn>>
    )

    const job = await claimTurn(runId)
    expect(await advanceAssistantRun(job)).toBe('published')

    const replies = await publicMessages(conversationId)
    expect(replies).toHaveLength(1)
    expect(replies[0].content).toBe('Your order is on its way.')

    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('succeeded')
    expect(run.outcome).toBe('answer')
    expect(run.resultMessageId).toBe(replies[0].id)
    // The behaviour the run executed under is recorded, not inferred later.
    expect(run.snapshotId).not.toBeNull()
    expect(run.jobLeaseToken).toBe(job.leaseToken)
  })

  it('publishes nothing when a teammate takes over mid-generation', async () => {
    const { conversationId, runId } = await seedTurn()

    // The barrier: the fake model blocks until the takeover has committed, so
    // the interleaving under test is the real one rather than a lucky ordering.
    let releaseModel: () => void = () => {}
    const modelBlocked = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    let generationStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      generationStarted = resolve
    })
    vi.mocked(runAssistantTurn).mockImplementation(async () => {
      generationStarted()
      await modelBlocked
      return answer('Here is the answer nobody should see.') as unknown as Awaited<
        ReturnType<typeof runAssistantTurn>
      >
    })

    const job = await claimTurn(runId)
    const turn = advanceAssistantRun(job)
    await started
    await invalidateAssistantWork(db, conversationId, 'human_reply')
    releaseModel()

    expect(await turn).toBe('fence:input_revision')
    expect(await publicMessages(conversationId)).toHaveLength(0)
    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('superseded')
    expect(run.disposition).toBe('fence:input_revision')
    expect(run.resultMessageId).toBeNull()
  })

  /**
   * A workflow parked at a `let_assistant_answer` node, delegating to `runId`.
   * The node has no outgoing edge, so a resume settles the run 'done' with no
   * actions: these cases are about WHETHER the wait resumes, not where to.
   */
  async function parkedWorkflowWait(conversationId: ConversationId, delegatedRunId: string) {
    const graph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'la', type: 'let_assistant_answer' },
      ],
      edges: [{ from: 't', to: 'la' }],
    }
    const [wf] = await db
      .insert(workflows)
      .values({
        name: `Let Quinn answer ${Math.random().toString(36).slice(2, 8)}`,
        class: 'customer_facing',
        status: 'live',
        triggerType: 'conversation.created',
        graph,
      })
      .returning()
    createdWorkflows.push(wf.id)
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        conversationId,
        state: 'waiting',
        customerFacing: true,
        graph,
        cursor: {
          waitKind: 'assistant',
          resumeNodeId: 'la',
          waitSeq: 1,
          waitSeconds: 0,
          waitStartedAt: new Date().toISOString(),
          delegatedRunId,
        },
      })
      .returning()
    return run
  }

  /** A delegated turn: the run a workflow park would have requested. */
  async function seedDelegatedTurn(workflowRunId: string, conversationId: ConversationId) {
    return db.transaction(async (tx) => {
      const [message] = await tx
        .insert(conversationMessages)
        .values({
          conversationId,
          principalId: visitorId,
          senderType: 'visitor',
          content: 'my invoice is wrong',
        })
        .returning()
      const requested = await requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `workflow:${workflowRunId}:la:1`,
        triggerKind: 'workflow_delegation',
        surface: 'workflow_step',
        triggerMessageId: message.id,
        delegation: { workflowRunId, nodeId: 'la', waitSeq: 1 },
      })
      return requested.run.id
    })
  }

  it('P4: an ordinary answer leaves the delegating wait parked', async () => {
    const conversationId = await newConversation()
    // The park writes the wait and the run together, so build them in that
    // order here too: the cursor names the run it delegated to.
    const placeholder = await seedDelegatedTurn('workflow_run_placeholder', conversationId)
    const workflowRun = await parkedWorkflowWait(conversationId, placeholder)
    await db
      .update(assistantRuns)
      .set({ delegation: { workflowRunId: workflowRun.id, nodeId: 'la', waitSeq: 1 } })
      .where(eq(assistantRuns.id, placeholder as never))

    vi.mocked(runAssistantTurn).mockResolvedValue(
      answer('Your invoice was corrected.') as unknown as Awaited<
        ReturnType<typeof runAssistantTurn>
      >
    )
    const job = await claimTurn(placeholder)
    expect(await advanceAssistantRun(job)).toBe('published')

    // Quinn answering is not the workflow's resolution branch: the wait is
    // still waiting for a hand-off, a close or its own expiry.
    const [after] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRun.id))
    expect(after.state).toBe('waiting')
  })

  it('P4: a hand-off resumes the delegating wait, by the visit it named', async () => {
    const conversationId = await newConversation()
    const placeholder = await seedDelegatedTurn('workflow_run_placeholder2', conversationId)
    const workflowRun = await parkedWorkflowWait(conversationId, placeholder)
    await db
      .update(assistantRuns)
      .set({ delegation: { workflowRunId: workflowRun.id, nodeId: 'la', waitSeq: 1 } })
      .where(eq(assistantRuns.id, placeholder as never))

    vi.mocked(runAssistantTurn).mockResolvedValue({
      ...answer('Let me get a teammate.'),
      escalation: {
        mode: 'handoff',
        reason: 'complex_issue',
        customerNeed: 'a refund decision',
        attempted: ['looked up the invoice'],
        recommendedNextStep: 'review the refund',
      },
    } as unknown as Awaited<ReturnType<typeof runAssistantTurn>>)
    const job = await claimTurn(placeholder)
    expect(await advanceAssistantRun(job)).toBe('published')

    const [after] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRun.id))
    expect(after.state).toBe('done')
  })

  it('P4: two workers running two turns for one conversation publish once', async () => {
    // The precondition P4 names before multiple attempts may be enabled
    // anywhere: durable customer mode under two workers. Both turns are real
    // intakes with real queue rows, and both executors run at the same time
    // on separate pooled connections.
    const conversationId = await newConversation()
    const first = await intake(conversationId)
    const secondTurn = await intake(conversationId)
    vi.mocked(runAssistantTurn).mockResolvedValue(
      answer('Both workers would say this.') as unknown as Awaited<
        ReturnType<typeof runAssistantTurn>
      >
    )

    const [firstRow] = await jobRowsFor(first.runId)
    const [secondRow] = await jobRowsFor(secondTurn.runId)
    const firstJob = await claimById(firstRow.job_id, 60_000)
    const secondJob = await claimById(secondRow.job_id, 60_000)
    expect(firstJob).toBeTruthy()
    expect(secondJob).toBeTruthy()

    const outcomes = await Promise.all([
      advanceAssistantRun(firstJob!),
      advanceAssistantRun(secondJob!),
    ])

    // One customer-visible outcome, whichever worker got there: the older turn
    // is fenced by the revision its own intake moved.
    expect(await publicMessages(conversationId)).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'published')).toHaveLength(1)
    const rows = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(rows.filter((r) => r.status === 'succeeded')).toHaveLength(1)
    expect(rows.filter((r) => r.status === 'succeeded' || r.status === 'superseded')).toHaveLength(
      2
    )
  })

  it('records a suppressed run when the engine declines to speak', async () => {
    const { conversationId, runId } = await seedTurn()
    vi.mocked(runAssistantTurn).mockResolvedValue({
      status: 'suppressed',
      reason: 'silence',
    } as unknown as Awaited<ReturnType<typeof runAssistantTurn>>)

    const job = await claimTurn(runId)
    expect(await advanceAssistantRun(job)).toBe('suppressed')
    expect(await publicMessages(conversationId)).toHaveLength(0)
    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('suppressed')
    expect(run.outcome).toBeNull()
  })
})
