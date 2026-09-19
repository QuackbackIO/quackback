/**
 * Real-DB coverage for the two recovery passes and the three operator
 * recovery controls (QUINN-PRODUCT Step 11, P8).
 *
 * Rows are seeded directly so each case controls the exact state a dead worker
 * would have left behind: a run still `running` with no job row, an approved
 * action whose queue row aged out, a receipt that says the effect was
 * attempted and never confirmed. Every case runs inside the fixture's
 * rolled-back transaction; the durability of the claim itself is Step 3's and
 * Step 5's committed-row suites, not this file's.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantPendingActions,
  assistantRuns,
  assistantToolCalls,
  conversations,
  jobQueue,
  principal,
  and,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockFailureFloor = vi.fn()
vi.mock('../assistant.orchestrator', () => ({
  runAssistantFailureFloor: (...args: unknown[]) => mockFailureFloor(...args),
}))

const mockAssistantPrincipal = vi.fn()
vi.mock('../assistant.principal', () => ({
  getAssistantPrincipal: (...args: unknown[]) => mockAssistantPrincipal(...args),
}))

import { getOpenRunState } from '../assistant-run.repository'
import {
  STRANDED_GRACE_MS,
  cancelAssistantRun,
  retryFailedAssistantRun,
  sweepStrandedApprovedActions,
  sweepStrandedAssistantRuns,
} from '../assistant-recovery'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantRuns.id }).from(assistantRuns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

async function seedPrincipal(): Promise<PrincipalId> {
  const [row] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  return row.id
}

async function seedConversation(): Promise<ConversationId> {
  const visitorPrincipalId = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId, channel: 'messenger' })
    .returning()
  return row.id
}

async function seedRun(
  conversationId: ConversationId,
  overrides: Partial<typeof assistantRuns.$inferInsert> = {}
) {
  const [row] = await testDb
    .insert(assistantRuns)
    .values({
      conversationId,
      surface: 'widget',
      triggerKind: 'customer_message',
      triggerKey: `trigger-${suffix()}`,
      status: 'running',
      updatedAt: minutesAgo(60),
      startedAt: minutesAgo(60),
      ...overrides,
    })
    .returning()
  return row
}

async function seedJobRow(input: {
  queue: string
  jobId: string
  dedupeKey: string
  status: 'pending' | 'running' | 'failed'
}) {
  await testDb.insert(jobQueue).values({
    jobId: input.jobId,
    queue: input.queue,
    dedupeKey: input.dedupeKey,
    status: input.status,
    maxAttempts: 1,
    ...(input.status === 'running'
      ? { leaseToken: crypto.randomUUID(), lockedUntil: new Date(Date.now() + 60_000) }
      : {}),
  })
}

async function readRun(id: (typeof assistantRuns.$inferSelect)['id']) {
  const [row] = await testDb.select().from(assistantRuns).where(eq(assistantRuns.id, id))
  return row
}

describe.skipIf(!fixture.available)('sweepStrandedAssistantRuns', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
  })

  it('fails a run left running by a worker that never came back', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { jobId: 'job_gone', status: 'running' })

    const result = await sweepStrandedAssistantRuns()

    expect(result.recovered).toBe(1)
    const after = await readRun(run.id)
    expect(after.status).toBe('failed')
    expect(after.disposition).toBe('stranded:no_worker')
    expect(after.finishedAt).not.toBeNull()
    // The dead turn is handed to a human by the same floor a live failure uses.
    expect(mockFailureFloor).toHaveBeenCalledWith(conversationId, 'principal_quinn')
  })

  it('leaves a run alone while its job row is still claimable', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { jobId: 'job_live', status: 'running' })
    await seedJobRow({
      queue: 'assistant-turn',
      jobId: 'job_live',
      dedupeKey: `assistant-turn:${run.id}`,
      status: 'running',
    })

    expect((await sweepStrandedAssistantRuns()).recovered).toBe(0)
    expect((await readRun(run.id)).status).toBe('running')
    expect(mockFailureFloor).not.toHaveBeenCalled()
  })

  it('leaves a run inside the grace alone, however dead its worker looks', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, {
      jobId: 'job_recent',
      status: 'running',
      updatedAt: new Date(Date.now() - Math.floor(STRANDED_GRACE_MS / 2)),
    })

    expect((await sweepStrandedAssistantRuns()).recovered).toBe(0)
    expect((await readRun(run.id)).status).toBe('running')
  })

  it('recovers a queued run whose turn job never made it to the queue', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'queued', startedAt: null })

    expect((await sweepStrandedAssistantRuns()).recovered).toBe(1)
    expect((await readRun(run.id)).status).toBe('failed')
  })

  it('never touches a run parked on a proposal, which the approval sweep owns', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, {
      status: 'waiting_action',
      disposition: 'waiting_action:assistant_action_x',
    })

    expect((await sweepStrandedAssistantRuns()).recovered).toBe(0)
    expect((await readRun(run.id)).status).toBe('waiting_action')
  })
})

async function seedApprovedAction(
  conversationId: ConversationId,
  overrides: Partial<typeof assistantPendingActions.$inferInsert> = {}
) {
  const [row] = await testDb
    .insert(assistantPendingActions)
    .values({
      conversationId,
      toolName: 'create_ticket',
      args: { title: 'x' },
      summary: 'Create a ticket',
      status: 'approved',
      executionState: 'queued',
      proposedAt: minutesAgo(120),
      decidedAt: minutesAgo(90),
      expiresAt: new Date(Date.now() + 3_600_000),
      actionKey: `conversation:${conversationId}:create_ticket:${suffix()}`,
      ...overrides,
    })
    .returning()
  return row
}

async function readAction(id: (typeof assistantPendingActions.$inferSelect)['id']) {
  const [row] = await testDb
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
  return row
}

async function actionJobs(dedupeKey: string) {
  return testDb
    .select()
    .from(jobQueue)
    .where(and(eq(jobQueue.queue, 'assistant-action'), eq(jobQueue.dedupeKey, dedupeKey)))
}

describe.skipIf(!fixture.available)('sweepStrandedApprovedActions', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  beforeEach(() => void vi.clearAllMocks())

  it('re-enqueues an approved action whose job row aged out of retention', async () => {
    const conversationId = await seedConversation()
    const action = await seedApprovedAction(conversationId, { executionJobId: 'job_pruned' })

    const result = await sweepStrandedApprovedActions()

    expect(result.requeued).toBe(1)
    const jobs = await actionJobs(`assistant-action:${action.id}`)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    // The row points at the job that will actually run it, not the pruned one.
    expect((await readAction(action.id)).executionJobId).toBe(jobs[0].jobId)
  })

  it('enqueues once however many times the sweep runs', async () => {
    const conversationId = await seedConversation()
    const action = await seedApprovedAction(conversationId, { executionJobId: 'job_pruned' })

    await sweepStrandedApprovedActions()
    const second = await sweepStrandedApprovedActions()

    expect(second.requeued).toBe(0)
    expect(await actionJobs(`assistant-action:${action.id}`)).toHaveLength(1)
  })

  it('leaves an action alone while its job row is still claimable', async () => {
    const conversationId = await seedConversation()
    const action = await seedApprovedAction(conversationId, { executionJobId: 'job_live_action' })
    await seedJobRow({
      queue: 'assistant-action',
      jobId: 'job_live_action',
      dedupeKey: `assistant-action:${action.id}`,
      status: 'pending',
    })

    expect((await sweepStrandedApprovedActions()).requeued).toBe(0)
  })

  it('never re-dispatches an effect a receipt says was already attempted', async () => {
    const conversationId = await seedConversation()
    const action = await seedApprovedAction(conversationId, { executionJobId: 'job_pruned' })
    await testDb.insert(assistantToolCalls).values({
      conversationId,
      pendingActionId: action.id,
      toolName: 'create_ticket',
      args: { title: 'x' },
      status: 'started',
      actionKey: action.actionKey,
      dispatchedAt: minutesAgo(80),
      replayStrategy: 'external_uncertain',
    })

    const result = await sweepStrandedApprovedActions()

    expect(result.requeued).toBe(0)
    expect(result.unconfirmed).toBe(1)
    expect(await actionJobs(`assistant-action:${action.id}`)).toHaveLength(0)
    const after = await readAction(action.id)
    expect(after.executionState).toBe('unknown')
  })

  it('settles the row from a receipt that already succeeded rather than running it again', async () => {
    const conversationId = await seedConversation()
    const action = await seedApprovedAction(conversationId, { executionJobId: 'job_pruned' })
    await testDb.insert(assistantToolCalls).values({
      conversationId,
      pendingActionId: action.id,
      toolName: 'create_ticket',
      args: { title: 'x' },
      status: 'succeeded',
      actionKey: action.actionKey,
      dispatchedAt: minutesAgo(80),
      settledAt: minutesAgo(80),
      outcomeStatus: 'succeeded',
      result: { ticketId: 'ticket_1' },
    })

    const result = await sweepStrandedApprovedActions()

    expect(result.requeued).toBe(0)
    expect(result.settled).toBe(1)
    expect(await actionJobs(`assistant-action:${action.id}`)).toHaveLength(0)
    const after = await readAction(action.id)
    expect(after.status).toBe('executed')
    expect(after.executionState).toBe('succeeded')
  })
})

describe.skipIf(!fixture.available)('the durable state a reconnect reads', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('says a turn is in flight while one is', async () => {
    const conversationId = await seedConversation()
    await seedRun(conversationId, { status: 'running' })
    expect(await getOpenRunState(conversationId)).toMatchObject({ status: 'running' })
  })

  it('says nothing once the run has settled, whatever it settled as', async () => {
    const conversationId = await seedConversation()
    await seedRun(conversationId, { status: 'succeeded', finishedAt: new Date() })
    // The phantom this exists to prevent: a reconnect after the answer landed
    // must not replay a typing indicator over a conversation that has its reply.
    expect(await getOpenRunState(conversationId)).toBeNull()
  })

  it('says nothing while a run is parked on an approval nobody has decided', async () => {
    const conversationId = await seedConversation()
    await seedRun(conversationId, { status: 'waiting_action' })
    // A wait can last hours. A customer is not kept looking at a typing
    // indicator for it; the acknowledgement in the thread is what they read.
    expect(await getOpenRunState(conversationId)).toBeNull()
  })
})

describe.skipIf(!fixture.available)('operator recovery controls', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  beforeEach(() => void vi.clearAllMocks())

  it('cancels a queued run and moves the conversation past it', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'queued', inputRevision: 0 })

    const cancelled = await cancelAssistantRun(run.id)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.disposition).toBe('cancelled:operator')
    const [conversation] = await testDb
      .select({ revision: conversations.assistantRevision })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    // The fence moved, so a worker still generating cannot publish.
    expect(Number(conversation.revision)).toBe(1)
  })

  it('releases a run parked on a proposal', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'waiting_action' })

    const cancelled = await cancelAssistantRun(run.id)
    expect(cancelled.status).toBe('cancelled')
  })

  it('refuses to cancel a run that has already finished', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'succeeded', finishedAt: new Date() })

    await expect(cancelAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_CANCELLABLE',
    })
  })

  it('retries a failed run that recorded no effect', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, {
      status: 'failed',
      disposition: 'error',
      finishedAt: minutesAgo(5),
    })

    const retry = await retryFailedAssistantRun(run.id)

    expect(retry.triggerKey).toBe(`retry:${run.id}`)
    expect(retry.status).toBe('queued')
    const jobs = await testDb
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, 'assistant-turn'),
          eq(jobQueue.dedupeKey, `assistant-turn:${retry.id}`)
        )
      )
    expect(jobs).toHaveLength(1)
  })

  it('refuses a second retry of the same run', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'failed', finishedAt: minutesAgo(5) })

    await retryFailedAssistantRun(run.id)
    await expect(retryFailedAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_RETRYABLE',
    })
  })

  it('refuses to retry a run that is not failed', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'running' })

    await expect(retryFailedAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_RETRYABLE',
    })
  })

  it('refuses to retry a run that took an action, whatever its outcome', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'failed', finishedAt: minutesAgo(5) })
    await testDb.insert(assistantToolCalls).values({
      conversationId,
      runId: run.id,
      toolName: 'create_ticket',
      args: { title: 'x' },
      status: 'failed',
      outcomeStatus: 'failed',
    })

    await expect(retryFailedAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_RETRYABLE',
    })
  })

  it('retries a run whose only receipts were reads', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'failed', finishedAt: minutesAgo(5) })
    await testDb.insert(assistantToolCalls).values({
      conversationId,
      runId: run.id,
      toolName: 'search',
      args: { query: 'x' },
      status: 'succeeded',
      outcomeStatus: 'succeeded',
    })

    const retry = await retryFailedAssistantRun(run.id)
    expect(retry.status).toBe('queued')
  })

  it('refuses to retry into a conversation a teammate has taken over', async () => {
    const conversationId = await seedConversation()
    const agentId = await seedPrincipal()
    const run = await seedRun(conversationId, { status: 'failed', finishedAt: minutesAgo(5) })
    await testDb
      .update(conversations)
      .set({ assignedAgentPrincipalId: agentId })
      .where(eq(conversations.id, conversationId))

    await expect(retryFailedAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_RETRYABLE',
    })
  })

  it('refuses to retry into a closed conversation', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId, { status: 'failed', finishedAt: minutesAgo(5) })
    await testDb
      .update(conversations)
      .set({ status: 'closed', resolvedAt: new Date(), endReason: 'resolved' })
      .where(eq(conversations.id, conversationId))

    await expect(retryFailedAssistantRun(run.id)).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_RETRYABLE',
    })
  })

  afterAll(fixture.close)
})
