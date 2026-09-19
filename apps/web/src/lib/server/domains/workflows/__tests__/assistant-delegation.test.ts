/**
 * Durable workflow delegation to Quinn (P4).
 *
 * Real PostgreSQL inside the fixture's rollback. What is under test is the
 * boundary between two state machines: the workflow run parks at a
 * `let_assistant_answer` node, and the Quinn turn that answers it is requested
 * in the SAME transaction as that park. Nothing here mocks a park, a run row or
 * a queue row; those are the mechanism.
 *
 * What is doubled is the orchestrator's eligibility preview (a settings and
 * entitlement read that has nothing to do with delegation) and its legacy
 * fire-and-forget entry point, which several cases assert is never called.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type AssistantRunId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type WorkflowRunId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantInvolvements,
  assistantRuns,
  conversations,
  principal,
  user,
  workflowRuns,
  eq,
  sql,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { WorkflowGraph } from '../graph'
import { makeConditionContext } from './workflow-test-utils'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { previewAssistantTurnForConversation, runAssistantTurnForConversation } = vi.hoisted(() => ({
  previewAssistantTurnForConversation: vi.fn(async () => 'eligible' as const),
  runAssistantTurnForConversation: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/assistant/assistant.orchestrator')
  >()),
  previewAssistantTurnForConversation,
  runAssistantTurnForConversation,
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))
vi.mock('@/lib/server/domains/settings/settings.workflows', () => ({
  getWorkflowAbandonedAutoCloseSettings: vi.fn(async () => ({
    enabled: false,
    waitMinutes: 5,
    keepIfEmailCaptured: true,
  })),
}))

/**
 * The executor is wrapped, not replaced: `let_assistant_answer` runs for real,
 * because the delegation it returns is the thing under test, while every other
 * action is recorded and skipped, because which EDGE a resume took is what the
 * assertions read and running a real close or priority write would drag the
 * conversation services and their realtime fan-out into this file.
 */
const { applyAction } = vi.hoisted(() => ({ applyAction: vi.fn() }))
vi.mock('../action.executor', async (importOriginal) => {
  const original = await importOriginal<typeof import('../action.executor')>()
  applyAction.mockImplementation(
    async (action: { type: string }, actionCtx: Parameters<typeof original.applyAction>[1]) =>
      action.type === 'let_assistant_answer'
        ? original.applyAction(action as Parameters<typeof original.applyAction>[0], actionCtx)
        : { label: action.type }
  )
  return { ...original, applyAction }
})

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { runWorkflow } from '../workflow.engine'
import { readCursor } from '../workflow-wait-queue'
import { completeAssistantDelegation } from '../assistant-delegation'
import { sweepExpiredAssistantWaits, sweepStrandedAssistantDelegations } from '../workflow-sweep'
import {
  commitAssistantOutcome,
  requestAssistantTurn,
  workflowDelegationTriggerKey,
} from '@/lib/server/domains/assistant/assistant-run.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
    await db
      .select({ id: assistantRuns.id, delegation: assistantRuns.delegation })
      .from(assistantRuns)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConversation(): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Person-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  return row.id
}

function assistantGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 't', type: 'trigger' },
      { id: 'la', type: 'let_assistant_answer', instructions: 'Billing only' },
      { id: 'a_default', type: 'action', action: { type: 'close' } },
      { id: 'a_escalated', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
    ],
    edges: [
      { from: 't', to: 'la' },
      { from: 'la', to: 'a_default' },
      { from: 'la', to: 'a_escalated', branch: 'escalated' },
    ],
  } as WorkflowGraph
}

const ctx = () =>
  makeConditionContext({
    conversation: {
      status: 'open',
      channel: 'messenger',
      priority: 'none',
      waitingMinutes: null,
      tagIds: [],
      assignedTeamId: null,
    },
  })

async function turnJobsFor(conversationId: ConversationId) {
  return getExecuteRows<{ job_id: string; payload: Record<string, unknown> }>(
    await testDb.execute(sql`
      SELECT job_id, payload FROM job_queue
      WHERE queue = 'assistant-turn' AND payload->>'conversationId' = ${conversationId}
    `)
  )
}

beforeEach(() => {
  previewAssistantTurnForConversation.mockClear()
  runAssistantTurnForConversation.mockClear()
  applyAction.mockClear()
})

describe.skipIf(!fixture.available)('durable workflow delegation', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('persists the delegation identity, the run intent and its job with the park itself', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Let Quinn answer',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: assistantGraph(),
    })

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('waiting')
    const cursor = readCursor(run!)
    expect(cursor).toMatchObject({ waitKind: 'assistant', resumeNodeId: 'la', waitSeq: 1 })

    // The turn was never launched out of band: the only thing that may answer
    // this wait is the durable run below, and it cannot start before commit.
    expect(runAssistantTurnForConversation).not.toHaveBeenCalled()

    const runs = await testDb
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(runs).toHaveLength(1)
    expect(runs[0].triggerKind).toBe('workflow_delegation')
    expect(runs[0].surface).toBe('workflow_step')
    expect(runs[0].delegation).toEqual({ workflowRunId: run!.id, nodeId: 'la', waitSeq: 1 })
    expect(runs[0].triggerKey).toBe(workflowDelegationTriggerKey(run!.id, 'la', 1))
    expect(cursor.delegatedRunId).toBe(runs[0].id)

    const jobs = await turnJobsFor(conversationId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload.runId).toBe(runs[0].id)
    expect(jobs[0].payload.stepInstructions).toBe('Billing only')
  })

  it('leaves no park and no run when the turn request fails', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Let Quinn answer',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: assistantGraph(),
    })

    // The queue insert is the half of the park transaction most likely to fail
    // in production (a full disk, a lock timeout). Either both halves commit or
    // neither does: a wait nothing can answer is the state this forbids.
    const queue = await import('@/lib/server/jobs/job-queue')
    const spy = vi.spyOn(queue, 'enqueueJob').mockRejectedValueOnce(new Error('queue down'))
    try {
      const run = await runWorkflow(wf, ctx(), { conversationId })
      // Interrupted, not parked and not left running: the customer-facing slot
      // is released rather than held until the stale sweep.
      expect(run?.state).toBe('interrupted')
    } finally {
      spy.mockRestore()
    }

    const runs = await testDb
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(runs).toHaveLength(0)
    const parked = await testDb
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.conversationId, conversationId))
    expect(parked.every((r) => r.state !== 'waiting')).toBe(true)
    expect(await turnJobsFor(conversationId)).toHaveLength(0)
  })

  it('replaying the same visit resolves to the same run instead of delegating twice', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Let Quinn answer',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: assistantGraph(),
    })
    const run = await runWorkflow(wf, ctx(), { conversationId })
    const first = await testDb
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))

    // What a retried wait job or a re-walked resume does: the same workflow
    // run, the same node, the same visit. The trigger key is the receipt.
    const replayed = await testDb.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: workflowDelegationTriggerKey(run!.id, 'la', 1),
        triggerKind: 'workflow_delegation',
        surface: 'workflow_step',
        delegation: { workflowRunId: run!.id, nodeId: 'la', waitSeq: 1 },
      })
    )
    expect(replayed.created).toBe(false)
    expect(replayed.run.id).toBe(first[0].id)
    const after = await testDb
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(after).toHaveLength(1)
    expect(await turnJobsFor(conversationId)).toHaveLength(1)
  })

  it('carries the delegation into the next turn of the same engagement', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Let Quinn answer',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: assistantGraph(),
    })
    const run = await runWorkflow(wf, ctx(), { conversationId })

    // The customer writes again while the workflow is still parked. This turn
    // is not the delegated one, but it belongs to the same engagement, so a
    // hand-off it produces must still be able to resume that wait.
    const next = await testDb.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:later`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    expect(next.run.delegation).toEqual({ workflowRunId: run!.id, nodeId: 'la', waitSeq: 1 })
  })

  it('carries nothing once the workflow has moved on', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Let Quinn answer',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: assistantGraph(),
    })
    const run = await runWorkflow(wf, ctx(), { conversationId })
    await testDb
      .update(workflowRuns)
      .set({ state: 'interrupted', endedAt: new Date() })
      .where(eq(workflowRuns.id, run!.id))

    const next = await testDb.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:later`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    expect(next.run.delegation).toBeNull()
  })

  describe('expiry', () => {
    /** Park, make the wait due, and hand back everything the cases poke at. */
    async function dueWait(opts: { ceilingPassed?: boolean } = {}) {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const run = await runWorkflow(wf, ctx(), { conversationId })
      const cursor = readCursor(run!)
      const past = new Date(Date.now() - 60_000).toISOString()
      await testDb
        .update(workflowRuns)
        .set({
          cursor: {
            ...cursor,
            expiresAt: past,
            ...(opts.ceilingPassed ? { expiryCeilingAt: past } : {}),
          },
        })
        .where(eq(workflowRuns.id, run!.id))
      const [delegated] = await testDb
        .select()
        .from(assistantRuns)
        .where(eq(assistantRuns.conversationId, conversationId))
      applyAction.mockClear()
      return { conversationId, runId: run!.id, delegatedRunId: delegated.id }
    }

    async function stateOf(runId: WorkflowRunId) {
      const [row] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      return row
    }

    async function settleDelegated(
      id: AssistantRunId,
      status: 'failed' | 'succeeded' | 'waiting_action'
    ) {
      await testDb.update(assistantRuns).set({ status }).where(eq(assistantRuns.id, id))
    }

    it('defers while the delegated turn is still executing', async () => {
      const { runId } = await dueWait()
      // The run is 'queued' from the park: the turn has not even started, let
      // alone died.
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(0)
      const after = await stateOf(runId)
      expect(after.state).toBe('waiting')
      expect(new Date(readCursor(after).expiresAt!).getTime()).toBeGreaterThan(Date.now())
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('defers while Quinn owes the result of an approved action', async () => {
      const { runId, delegatedRunId } = await dueWait()
      await settleDelegated(delegatedRunId, 'waiting_action')
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(0)
      expect((await stateOf(runId)).state).toBe('waiting')
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('defers while Quinn has answered and the customer has not come back', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait()
      await settleDelegated(delegatedRunId, 'succeeded')
      await testDb.insert(assistantInvolvements).values({
        conversationId,
        triggeredBy: 'first_touch',
        status: 'active',
        lastAssistantAnswerAt: new Date(),
      })
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(0)
      expect((await stateOf(runId)).state).toBe('waiting')
    })

    it('escalates when the execution died with nothing delivered, and fences Quinn in the same claim', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait()
      await settleDelegated(delegatedRunId, 'failed')
      const [before] = await testDb
        .select({ revision: conversations.assistantRevision })
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)
      const after = await stateOf(runId)
      expect(after.state).toBe('done')
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'set_priority' })
      const [now] = await testDb
        .select({ revision: conversations.assistantRevision })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      expect(now.revision).toBeGreaterThan(before.revision)
    })

    it('a late answer cannot publish after the expiry took Quinn authority', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait()
      // A worker that was mid-generation when the wait expired: it holds the
      // revision it started with.
      const [claimed] = await testDb
        .update(assistantRuns)
        .set({ status: 'running', jobLeaseToken: 'lease-1' })
        .where(eq(assistantRuns.id, delegatedRunId))
        .returning()

      await sweepExpiredAssistantWaits(new Date())
      const deferred = await stateOf(runId)
      expect(deferred.state).toBe('waiting') // executing: deferred, not escalated

      // The worker dies. The next tick past the new deadline finds nothing
      // alive and takes the escalated edge.
      await settleDelegated(delegatedRunId, 'failed')
      await testDb
        .update(workflowRuns)
        .set({
          cursor: { ...readCursor(deferred), expiresAt: new Date(Date.now() - 1000).toISOString() },
        })
        .where(eq(workflowRuns.id, runId))
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)

      const outcome = await testDb.transaction((tx) =>
        commitAssistantOutcome(tx, {
          runId: claimed.id,
          conversationId,
          expectedInputRevision: claimed.inputRevision,
          expectedStateVersion: claimed.stateVersion,
          jobLeaseToken: 'lease-1',
          author: {
            principalId: (claimed.requestedByPrincipalId ?? createId('principal')) as PrincipalId,
            displayName: 'Quinn',
          },
          candidate: {
            text: 'Here is your answer',
            responseKind: 'answer',
            outcome: 'answer',
            citations: [],
            handoff: null,
          },
        })
      )
      expect(outcome).toMatchObject({ kind: 'rejected', reason: 'fence:input_revision' })
    })

    it('releases rather than escalating into a conversation that is no longer open', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait()
      await settleDelegated(delegatedRunId, 'failed')
      await testDb
        .update(conversations)
        .set({ status: 'closed' })
        .where(eq(conversations.id, conversationId))

      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)
      expect((await stateOf(runId)).state).toBe('interrupted')
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('releases without taking either edge once a teammate has taken over', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait()
      await settleDelegated(delegatedRunId, 'failed')
      const [agent] = await testDb
        .select({ id: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      await testDb
        .update(conversations)
        .set({ assignedAgentPrincipalId: agent.id as PrincipalId })
        .where(eq(conversations.id, conversationId))

      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)
      expect((await stateOf(runId)).state).toBe('interrupted')
      // Neither branch ran: an escalation nobody asked for would route a
      // customer a human already has.
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('releases at the ceiling when Quinn answered, rather than claiming an escalation', async () => {
      const { conversationId, runId, delegatedRunId } = await dueWait({ ceilingPassed: true })
      await settleDelegated(delegatedRunId, 'succeeded')
      await testDb.insert(assistantInvolvements).values({
        conversationId,
        triggeredBy: 'first_touch',
        status: 'active',
        lastAssistantAnswerAt: new Date(),
      })
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)
      expect((await stateOf(runId)).state).toBe('interrupted')
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('escalates at the ceiling when nothing was ever delivered, even mid-execution', async () => {
      const { runId } = await dueWait({ ceilingPassed: true })
      expect(await sweepExpiredAssistantWaits(new Date())).toBe(1)
      expect((await stateOf(runId)).state).toBe('done')
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'set_priority' })
    })
  })

  describe('stranded recovery', () => {
    async function parkedLongAgo() {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const run = await runWorkflow(wf, ctx(), { conversationId })
      const cursor = readCursor(run!)
      const old = new Date(Date.now() - 30 * 60_000).toISOString()
      await testDb
        .update(workflowRuns)
        .set({ cursor: { ...cursor, waitStartedAt: old } })
        .where(eq(workflowRuns.id, run!.id))
      const [delegated] = await testDb
        .select()
        .from(assistantRuns)
        .where(eq(assistantRuns.conversationId, conversationId))
      applyAction.mockClear()
      return { conversationId, runId: run!.id, delegatedRunId: delegated.id }
    }

    it('resumes a wait whose delegated run died without telling it', async () => {
      const { runId, delegatedRunId } = await parkedLongAgo()
      // The run settled and the process died before it could resume the wait.
      await testDb
        .update(assistantRuns)
        .set({ status: 'failed', disposition: 'error' })
        .where(eq(assistantRuns.id, delegatedRunId))

      expect(await sweepStrandedAssistantDelegations(new Date())).toBe(1)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      expect(after.state).toBe('done')
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'set_priority' })
    })

    it('recovers a delegation whose turn job never ran', async () => {
      const { runId, delegatedRunId } = await parkedLongAgo()
      // The missing wake: the job row is gone and the run is still queued, so
      // nothing will ever claim it.
      await testDb.execute(
        sql`DELETE FROM job_queue WHERE dedupe_key = ${`assistant-turn:${delegatedRunId}`}`
      )
      await testDb
        .update(assistantRuns)
        .set({ updatedAt: new Date(Date.now() - 30 * 60_000) })
        .where(eq(assistantRuns.id, delegatedRunId))

      expect(await sweepStrandedAssistantDelegations(new Date())).toBe(1)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      expect(after.state).toBe('done')
      const [run] = await testDb
        .select()
        .from(assistantRuns)
        .where(eq(assistantRuns.id, delegatedRunId))
      expect(run.status).toBe('failed')
      expect(run.disposition).toBe('stranded:no_turn_job')
    })

    it('resumes a wait whose run handed off without ever telling it', async () => {
      const { runId, delegatedRunId } = await parkedLongAgo()
      // The hand-off published and the run settled; the process died before
      // the completion could resume the wait.
      await testDb
        .update(assistantRuns)
        .set({ status: 'succeeded', outcome: 'handoff' })
        .where(eq(assistantRuns.id, delegatedRunId))

      expect(await sweepStrandedAssistantDelegations(new Date())).toBe(1)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      expect(after.state).toBe('done')
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'set_priority' })
    })

    it('leaves a wait alone when the run simply answered', async () => {
      const { runId, delegatedRunId } = await parkedLongAgo()
      await testDb
        .update(assistantRuns)
        .set({ status: 'succeeded', outcome: 'answer' })
        .where(eq(assistantRuns.id, delegatedRunId))

      expect(await sweepStrandedAssistantDelegations(new Date())).toBe(0)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      expect(after.state).toBe('waiting')
    })

    it('leaves a wait alone while any Quinn run on the conversation is still open', async () => {
      const { conversationId, runId, delegatedRunId } = await parkedLongAgo()
      await testDb
        .update(assistantRuns)
        .set({ status: 'failed' })
        .where(eq(assistantRuns.id, delegatedRunId))
      // A later turn inherited the delegation and is still going; it owes the
      // completion, not this sweep.
      await testDb.insert(assistantRuns).values({
        conversationId,
        surface: 'widget',
        triggerKind: 'customer_message',
        triggerKey: `conversation:${conversationId}:message:later`,
        status: 'running',
      })

      expect(await sweepStrandedAssistantDelegations(new Date())).toBe(0)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, runId))
      expect(after.state).toBe('waiting')
    })
  })

  describe('completing a delegation', () => {
    async function parkedRun() {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const run = await runWorkflow(wf, ctx(), { conversationId })
      // The park's own action is not what these cases read: they read which
      // edge the RESUME took.
      applyAction.mockClear()
      return { conversationId, run: run! }
    }

    it('resumes the escalated edge, once', async () => {
      const { run } = await parkedRun()
      const delegation = { workflowRunId: run.id, nodeId: 'la', waitSeq: 1 }

      expect(await completeAssistantDelegation(delegation, 'escalated')).toBe(true)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('done')
      // set_priority is the escalated edge's action; close is the default edge's.
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'set_priority' })

      // A duplicate completion is harmless: the wait is no longer claimable.
      expect(await completeAssistantDelegation(delegation, 'escalated')).toBe(false)
      expect(applyAction).toHaveBeenCalledTimes(1)
    })

    it('leaves a newer wait untouched when an older completion arrives', async () => {
      const { run } = await parkedRun()
      // The workflow moved on and parked again: a second visit, a second
      // sequence number. The first delegation names the visit it was made for.
      await testDb
        .update(workflowRuns)
        .set({
          cursor: {
            waitKind: 'assistant',
            resumeNodeId: 'la',
            waitSeq: 2,
            waitSeconds: 0,
            waitStartedAt: new Date().toISOString(),
            delegatedRunId: 'assistant_run_second',
          },
        })
        .where(eq(workflowRuns.id, run.id))

      expect(
        await completeAssistantDelegation(
          { workflowRunId: run.id, nodeId: 'la', waitSeq: 1 },
          'escalated'
        )
      ).toBe(false)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting')
      expect(readCursor(after).waitSeq).toBe(2)
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('leaves a wait for a different node untouched', async () => {
      const { run } = await parkedRun()
      expect(
        await completeAssistantDelegation(
          { workflowRunId: run.id, nodeId: 'somewhere_else', waitSeq: 1 },
          'escalated'
        )
      ).toBe(false)
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting')
    })

    it('resumes the default edge on a lifecycle resolution', async () => {
      const { run } = await parkedRun()
      expect(
        await completeAssistantDelegation(
          { workflowRunId: run.id, nodeId: 'la', waitSeq: 1 },
          'resolved'
        )
      ).toBe(true)
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'close' })
    })
  })
})
