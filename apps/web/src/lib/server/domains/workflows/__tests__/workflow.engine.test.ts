/**
 * Real-DB coverage for the workflow run engine (§4.6, Slice 5d-i). The engine's
 * job is orchestration: walk the graph, invoke the shared executor for each
 * planned action in order, and record the run + timeline. The action *effects* are
 * covered by action.executor + sla.service tests, so here applyAction is spied
 * (the real conversation mutations emit realtime/events that need runtime config)
 * while the workflow_runs / workflow_run_events writes stay real. Runs inside the
 * fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  toUuid,
  type PrincipalId,
  type UserId,
  type ConversationId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  workflowRuns,
  workflowRunEvents,
  workflows,
  user,
  principal,
  eq,
  and,
  sql,
} from '@/lib/server/db'
import type { ConditionContext } from '../condition.evaluator'
import type { WorkflowGraph } from '../graph'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Spy the executor — the engine only orchestrates; action effects are tested
// against the real services elsewhere. vi.hoisted so it exists at mock-factory time.
const { applyAction, scheduleWorkflowResume } = vi.hoisted(() => ({
  applyAction: vi.fn().mockResolvedValue('ok'),
  scheduleWorkflowResume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../action.executor', () => ({ applyAction }))
// The durable-wait timer is BullMQ; the engine's scheduling call is spied here,
// keeping the rest of the module (workflowWaitJobId) real so tests can rebuild
// the job id a scheduled call would have used.
vi.mock('../workflow-wait-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workflow-wait-queue')>()),
  scheduleWorkflowResume,
}))
// Wrapped, delegating to the real resolver by default, so a test can inject a
// one-shot failure mid-resume without changing any other test's behavior.
vi.mock('../condition.context', async (importOriginal) => {
  const original = await importOriginal<typeof import('../condition.context')>()
  return { ...original, resolveConditionContext: vi.fn(original.resolveConditionContext) }
})
// Resume rebuilds its condition context, which reads the workspace office-hours
// schedule from the settings blob — the fixture has no settings row, so pin the
// default (disabled = 24/7) like condition.context.test.ts does.
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({
    enabled: false,
    timezone: 'UTC',
    intervals: [],
  })),
}))
// Same wrap-not-replace treatment as condition.context above (SF8): applyAction
// itself is fully mocked in this file, so send_block's OWN internal calls to
// these never happen here — these spies exist purely to prove
// applyPlanAndSettle's hoisted per-plan resolution (see workflow.engine.ts)
// calls each exactly once per plan, however many send_block actions it has.
vi.mock('../workflow-variables', async (importOriginal) => {
  const original = await importOriginal<typeof import('../workflow-variables')>()
  return { ...original, resolveWorkflowVariables: vi.fn(original.resolveWorkflowVariables) }
})
vi.mock('@/lib/server/domains/assistant/assistant.principal', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/server/domains/assistant/assistant.principal')>()
  return { ...original, ensureAssistantPrincipal: vi.fn(original.ensureAssistantPrincipal) }
})

import {
  createWorkflow,
  setWorkflowStatus,
  updateWorkflow,
  softDeleteWorkflow,
} from '../workflow.service'
import { runWorkflow, resumeWorkflowRun, interruptWaitingRuns } from '../workflow.engine'
import { workflowWaitJobId } from '../workflow-wait-queue'
import { resolveConditionContext } from '../condition.context'
import { resolveWorkflowVariables } from '../workflow-variables'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: workflowRuns.id, customerFacing: workflowRuns.customerFacing })
      .from(workflowRuns)
      .limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** A standalone principal, not tied to any conversation — used as a
 *  frequency-cap subject shared across multiple conversations' runs. */
async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Person-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedConversation(): Promise<ConversationId> {
  const principalId = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  return row.id
}

const ctx = (status = 'open'): ConditionContext => ({
  conversation: {
    status,
    channel: 'messenger',
    priority: 'none',
    waitingMinutes: null,
    tagIds: [],
    assignedTeamId: null,
  },
})

beforeEach(() => {
  applyAction.mockClear()
  scheduleWorkflowResume.mockClear()
})

describe.skipIf(!fixture.available)('runWorkflow (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('runs each planned action in order and records a completed run + timeline', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Escalate + close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'a2', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'a1' },
          { from: 'a1', to: 'a2' },
        ],
      },
    })

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('done')
    expect(run?.endedAt).not.toBeNull()

    // Both actions dispatched, in order, against this conversation.
    expect(applyAction).toHaveBeenCalledTimes(2)
    expect(applyAction.mock.calls[0][0]).toEqual({ type: 'set_priority', priority: 'urgent' })
    expect(applyAction.mock.calls[1][0]).toEqual({ type: 'close' })
    expect(applyAction.mock.calls[0][1]).toMatchObject({ conversationId })

    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run!.id))
    expect(events.map((e) => e.kind).sort()).toEqual(['completed', 'started'])
  })

  it('pauses at a wait with a resume cursor, running only the pre-wait actions', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Escalate, wait, close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'w', type: 'wait', seconds: 3600 },
          { id: 'a2', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'a1' },
          { from: 'a1', to: 'w' },
          { from: 'w', to: 'a2' },
        ],
      },
    })

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('waiting')
    expect(run?.cursor).toMatchObject({ resumeNodeId: 'a2', waitSeconds: 3600 })
    // Only the pre-wait action ran; the post-wait one waits for resume.
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(applyAction.mock.calls[0][0]).toEqual({ type: 'set_priority', priority: 'urgent' })
    // The durable timer was scheduled for this run, keyed to its first wait.
    expect(scheduleWorkflowResume).toHaveBeenCalledWith(run!.id, 3600, 1)

    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run!.id))
    expect(events.map((e) => e.kind).sort()).toEqual(['started', 'waiting'])
  })

  it('resumes a waiting run from its cursor and completes it', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live') // a resume only acts on a live workflow
    const waiting = await runWorkflow(wf, ctx(), { conversationId })
    expect(waiting?.state).toBe('waiting')
    expect(applyAction).not.toHaveBeenCalled() // nothing before the wait

    // The timer fires -> resume walks from the cursor and runs the tail.
    const resumed = await resumeWorkflowRun(waiting!.id)
    expect(resumed?.state).toBe('done')
    expect(resumed?.endedAt).not.toBeNull()
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' })
  })

  it('does not resume a run that was interrupted while waiting', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    const waiting = await runWorkflow(wf, ctx(), { conversationId })

    // A reply/close interrupts every waiting run on the conversation.
    expect(await interruptWaitingRuns(conversationId)).toBe(1)

    // A late timer resolves to a no-op: the tail never runs.
    expect(await resumeWorkflowRun(waiting!.id)).toBeNull()
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('schedules a distinct durable-timer job id for each wait in a single run', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait, act, wait, act',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w1', type: 'wait', seconds: 60 },
          { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'w2', type: 'wait', seconds: 120 },
          { id: 'a2', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w1' },
          { from: 'w1', to: 'a1' },
          { from: 'a1', to: 'w2' },
          { from: 'w2', to: 'a2' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')

    const parkedAtFirstWait = await runWorkflow(wf, ctx(), { conversationId })
    expect(parkedAtFirstWait?.state).toBe('waiting')

    // Resuming the first wait runs a1, then parks again at the second wait —
    // this is the case that used to strand: the old jobId was keyed by run id
    // alone, so this second schedule call would dedupe against the first.
    const parkedAtSecondWait = await resumeWorkflowRun(parkedAtFirstWait!.id)
    expect(parkedAtSecondWait?.state).toBe('waiting')
    expect(parkedAtSecondWait?.id).toBe(parkedAtFirstWait!.id) // same run throughout

    const done = await resumeWorkflowRun(parkedAtFirstWait!.id)
    expect(done?.state).toBe('done')

    expect(scheduleWorkflowResume).toHaveBeenCalledTimes(2)
    const [, , firstWaitSeq] = scheduleWorkflowResume.mock.calls[0]
    const [, , secondWaitSeq] = scheduleWorkflowResume.mock.calls[1]
    const firstJobId = workflowWaitJobId(parkedAtFirstWait!.id, firstWaitSeq as number)
    const secondJobId = workflowWaitJobId(parkedAtFirstWait!.id, secondWaitSeq as number)
    expect(firstJobId).not.toBe(secondJobId)
  })

  it('rejects a second resume once a run has been claimed, running nothing', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')
    const waiting = await runWorkflow(wf, ctx(), { conversationId })

    // Simulate another resume attempt already having claimed this run (flipped
    // it to 'running') but not yet having settled it — e.g. it is still mid
    // action, or it crashed before reaching a settle.
    await testDb
      .update(workflowRuns)
      .set({ state: 'running' })
      .where(eq(workflowRuns.id, waiting!.id))

    const second = await resumeWorkflowRun(waiting!.id)
    expect(second).toBeNull() // the atomic claim only matches state = 'waiting'
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('keeps a run interrupted (not resurrected) when the interrupt lands mid-run, before the settle', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'act then wait',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a2', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'a' },
          { from: 'a', to: 'w' },
          { from: 'w', to: 'a2' },
        ],
      },
    })

    // A reply/close interrupts the run in the window between the actions
    // running and the settle write. applyAction is the only hook available at
    // that point, so it stands in for the interleaving.
    applyAction.mockImplementationOnce(async () => {
      await interruptWaitingRuns(conversationId)
      return 'ok'
    })

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('interrupted') // the interrupt won, not the wait settle
    expect(scheduleWorkflowResume).not.toHaveBeenCalled() // no timer for a run that isn't parked

    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run!.id))
    // Only 'started' — no 'waiting' (settle lost the race) and no 'completed'.
    expect(events.map((e) => e.kind).sort()).toEqual(['started'])
  })

  it('interrupts (does not act) a paused workflow whose wait resumes after the pause', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')
    const waiting = await runWorkflow(wf, ctx(), { conversationId })
    expect(waiting?.state).toBe('waiting')

    // Paused after the run parked, before its timer fired — pausing only stops
    // new dispatches, so this run is still sitting at the wait.
    await setWorkflowStatus(wf.id, 'paused')

    const resumed = await resumeWorkflowRun(waiting!.id)
    expect(resumed?.state).toBe('interrupted')
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('settles a run parked at a successor-less wait as done even when the workflow was paused', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'act then trailing wait',
      class: 'background',
      triggerType: 'conversation.created',
      // The wait is the last node: nothing runs after it, so the run's work
      // finished before it parked — resuming is bookkeeping, not action.
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'w', type: 'wait', seconds: 60 },
        ],
        edges: [
          { from: 't', to: 'a' },
          { from: 'a', to: 'w' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')
    const waiting = await runWorkflow(wf, ctx(), { conversationId })
    expect(waiting?.state).toBe('waiting')
    expect(waiting?.cursor).toMatchObject({ resumeNodeId: null })

    // Paused while parked. The run completed its actions before the wait, so
    // it must count as done, not interrupted — there was nothing left to skip.
    await setWorkflowStatus(wf.id, 'paused')

    const resumed = await resumeWorkflowRun(waiting!.id)
    expect(resumed?.state).toBe('done')
  })

  it('stamps the resume moment into the cursor at claim time', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')
    const waiting = await runWorkflow(wf, ctx(), { conversationId })
    expect((waiting?.cursor as { resumedAt?: string }).resumedAt).toBeUndefined()

    const before = Date.now()
    const resumed = await resumeWorkflowRun(waiting!.id)
    expect(resumed?.state).toBe('done')
    // The claim merged resumedAt into the cursor; the settle preserved it. The
    // sweeper reads it as the run's liveness marker, since a timer can fire
    // much later than the wait's scheduled time.
    const resumedAt = (resumed?.cursor as { resumedAt?: string }).resumedAt
    expect(resumedAt).toBeDefined()
    expect(new Date(resumedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('reverts the claim and rethrows when a resume fails post-claim, so a retry can claim again', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'wait then close',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 60 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })
    await setWorkflowStatus(wf.id, 'live')
    const waiting = await runWorkflow(wf, ctx(), { conversationId })
    expect(waiting?.state).toBe('waiting')

    // A transient failure after the claim (e.g. a DB blip loading the context)
    // must propagate so the queue retries the job — and the claim must be
    // reverted, or the retry's waiting -> running update would match zero rows
    // and silently strand the run in 'running'.
    vi.mocked(resolveConditionContext).mockRejectedValueOnce(new Error('transient blip'))
    await expect(resumeWorkflowRun(waiting!.id)).rejects.toThrow('transient blip')

    const [row] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, waiting!.id))
    expect(row.state).toBe('waiting') // claim reverted, not stuck 'running'

    // The retry finds the run claimable and completes it.
    const resumed = await resumeWorkflowRun(waiting!.id)
    expect(resumed?.state).toBe('done')
    expect(applyAction).toHaveBeenCalledTimes(1)
  })

  it('is a silent no-op (no run, no dispatch) when the entry gate matches nothing', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'Only closed',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.status', op: 'eq', value: 'closed' },
          },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'g' },
          { from: 'g', to: 'a' },
        ],
      },
    })

    const run = await runWorkflow(wf, ctx('open'), { conversationId })
    expect(run).toBeNull()
    expect(applyAction).not.toHaveBeenCalled()
    const runs = await testDb.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wf.id))
    expect(runs).toHaveLength(0)
  })

  it('continues past a failing action and marks it on the timeline', async () => {
    const conversationId = await seedConversation()
    applyAction.mockRejectedValueOnce(new Error('boom')) // first action throws
    const wf = await createWorkflow({
      name: 'Two actions',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'a2', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'a1' },
          { from: 'a1', to: 'a2' },
        ],
      },
    })

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('done') // one bad action doesn't strand the run
    expect(applyAction).toHaveBeenCalledTimes(2) // still ran the second
    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run!.id))
    expect(events.map((e) => e.kind).sort()).toEqual([
      'action_failed:set_priority',
      'completed',
      'started',
    ])
  })

  it('enforces the customer_facing exclusive lock at the DB level: a lock-lost race is skipped, not thrown', async () => {
    const conversationId = await seedConversation()
    const wf = await createWorkflow({
      name: 'CF workflow',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      // A wait keeps the first run in state 'waiting' (still exclusive) rather
      // than settling straight to 'done', so the second call actually contends
      // for the lock instead of finding it already released.
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'w', type: 'wait', seconds: 3600 },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'w' },
          { from: 'w', to: 'a' },
        ],
      },
    })

    // Both calls would pass hasActiveCustomerFacingRun's read (there is nothing
    // to see yet) — exactly what two triggers firing close together
    // (conversation.created + the first message.created) would do. Run
    // sequentially (this fixture's single connection can't safely interleave two
    // concurrent nested transactions) so the second call deterministically hits
    // the same insert-time conflict a true race would produce; the DB's partial
    // unique index, not the read-only pre-check, is what must decide.
    const first = await runWorkflow(wf, ctx(), { conversationId })
    const second = await runWorkflow(wf, ctx(), { conversationId })
    expect(first?.state).toBe('waiting')
    expect(second).toBeNull() // lock lost, skipped rather than thrown

    const rows = await testDb
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.conversationId, conversationId))
    expect(rows).toHaveLength(1)
    expect(rows[0].customerFacing).toBe(true)
  })

  it('a background-class run on the same conversation still inserts fine alongside a customer_facing run', async () => {
    const conversationId = await seedConversation()
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [{ from: 't', to: 'a' }],
    }
    const cf = await createWorkflow({
      name: 'CF workflow',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph,
    })
    const bg = await createWorkflow({
      name: 'BG workflow',
      class: 'background',
      triggerType: 'conversation.created',
      graph,
    })

    const cfRun = await runWorkflow(cf, ctx(), { conversationId })
    const bgRun = await runWorkflow(bg, ctx(), { conversationId })
    expect(cfRun).not.toBeNull()
    expect(bgRun).not.toBeNull() // the exclusive index only scopes customer_facing rows

    const rows = await testDb
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.conversationId, conversationId))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.customerFacing).sort()).toEqual([false, true])
  })

  describe('frequency cap race-proofing (advisory lock + in-transaction re-check)', () => {
    it('re-checks the cap authoritatively at insert time: a second call sees the first started event and is denied', async () => {
      const wf = await createWorkflow({
        name: 'Once-capped background workflow',
        class: 'background',
        triggerType: 'conversation.created',
        triggerSettings: { frequencyCap: { type: 'once' } },
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
      const person = await seedPrincipal()
      const conversationA = await seedConversation()
      const conversationB = await seedConversation()

      // Sequential (this fixture's single connection can't interleave two
      // concurrent transactions — see the customer_facing lock test above for
      // the same caveat); the real concurrent race is covered separately
      // against a real, non-rollback DB in frequency-cap-race.test.ts. This
      // pins the correctness of the re-check itself: runWorkflow used to have
      // no cap awareness at all (only the dispatcher's pre-check did), so
      // this is new behavior, not just a race fix.
      const first = await runWorkflow(wf, ctx(), {
        conversationId: conversationA,
        subjectPrincipalId: person,
      })
      const second = await runWorkflow(wf, ctx(), {
        conversationId: conversationB,
        subjectPrincipalId: person,
      })

      expect(first?.state).toBe('done')
      expect(second).toBeNull() // cap denied on the authoritative re-check

      const runs = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, wf.id))
      expect(runs).toHaveLength(1)

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.workflowId, wf.id))
      expect(events.filter((e) => e.kind === 'started')).toHaveLength(1)
    })

    it('does not gate an uncapped workflow: the same person can start it on two different conversations', async () => {
      const wf = await createWorkflow({
        name: 'Uncapped background workflow',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
      const person = await seedPrincipal()
      const conversationA = await seedConversation()
      const conversationB = await seedConversation()

      const first = await runWorkflow(wf, ctx(), {
        conversationId: conversationA,
        subjectPrincipalId: person,
      })
      const second = await runWorkflow(wf, ctx(), {
        conversationId: conversationB,
        subjectPrincipalId: person,
      })

      expect(first?.state).toBe('done')
      expect(second?.state).toBe('done') // nothing to cap, no lock taken, no denial

      const runs = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, wf.id))
      expect(runs).toHaveLength(2)
    })

    it('logs the started event in the same transaction as the run insert (visible immediately, not only after a later call)', async () => {
      const wf = await createWorkflow({
        name: 'n_total capped workflow',
        class: 'background',
        triggerType: 'conversation.created',
        triggerSettings: { frequencyCap: { type: 'n_total', count: 1 } },
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
      const person = await seedPrincipal()
      const conversationId = await seedConversation()

      const run = await runWorkflow(wf, ctx(), { conversationId, subjectPrincipalId: person })
      expect(run?.state).toBe('done')

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(and(eq(workflowRunEvents.workflowId, wf.id), eq(workflowRunEvents.kind, 'started')))
      expect(events).toHaveLength(1)
      expect(events[0].runId).toBe(run!.id)
    })
  })

  describe('graph-version snapshot pinning (G1 regression)', () => {
    it('resumes on the ORIGINAL post-wait action, ignoring an edit made while the run was parked', async () => {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'wait then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      // The run's own snapshot, not a live reference, pinned at insert time.
      expect(waiting?.graph).toMatchObject({ nodes: expect.any(Array) })

      // Edit the workflow while the run sits parked: the post-wait node 'a' now
      // sets priority instead of closing. A live workflow (still 'live', still
      // has a node with this id) is exactly the case that used to silently walk
      // the new logic instead of the run's original path.
      await updateWorkflow(wf.id, {
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })

      const resumed = await resumeWorkflowRun(waiting!.id)
      expect(resumed?.state).toBe('done')
      // The ORIGINAL action ran, not the edited one.
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' })
    })

    it('resumes down the ORIGINAL path when the resume node was deleted from the live graph, instead of silently settling done', async () => {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'wait then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      expect(waiting?.cursor).toMatchObject({ resumeNodeId: 'a' })

      // Delete the resume node from the live workflow while the run is parked.
      // Against the live graph, walking from 'a' finds no such node and the old
      // code path would silently settle the run 'done' with no action taken.
      await updateWorkflow(wf.id, {
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
          ],
          edges: [{ from: 't', to: 'w' }],
        },
      })

      const resumed = await resumeWorkflowRun(waiting!.id)
      expect(resumed?.state).toBe('done')
      // The action still ran: the snapshot still has node 'a', unlike the live
      // graph. A silent no-action 'done' (the bug) would leave this at 0.
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' })
    })

    it('still interrupts (does not act) a run parked at a wait whose workflow was soft-deleted', async () => {
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'wait then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')

      // The workflow itself is deleted while the run sits parked. The graph
      // snapshot has nothing to do with this: a vanished workflow must still
      // settle the run interrupted rather than act on a snapshot of something
      // that no longer exists.
      await softDeleteWorkflow(wf.id)

      const resumed = await resumeWorkflowRun(waiting!.id)
      expect(resumed?.state).toBe('interrupted')
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('resumes correctly after a backfill-style repair of a run stranded with an empty graph snapshot (0184/0185 regression)', async () => {
      // 0184 added workflow_runs.graph with a bare '{}' default and no
      // backfill: a run that was already parked 'waiting' at deploy time
      // carries an empty snapshot. Simulate that stranded row directly
      // (rather than via runWorkflow, which always stamps the real graph),
      // confirm the empty snapshot really does drop the post-wait action,
      // then apply 0185's backfill UPDATE and confirm the same run resumes
      // into the real graph instead.
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'wait then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      await setWorkflowStatus(wf.id, 'live')

      const [stranded] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          graph: {}, // the pre-backfill default, not a real snapshot
          cursor: { resumeNodeId: 'a' },
        })
        .returning()

      // 0185's backfill: UPDATE workflow_runs SET graph = workflows.graph
      // FROM workflows WHERE workflow_runs.workflow_id = workflows.id AND
      // workflow_runs.graph = '{}'::jsonb — scoped here to this one row.
      // (Raw sql bypasses the TypeID<->uuid column mapping, so ids are
      // converted to their raw uuid form with toUuid before interpolation.)
      await testDb.execute(sql`
        UPDATE ${workflowRuns}
        SET graph = ${workflows}.graph
        FROM ${workflows}
        WHERE ${workflowRuns}.workflow_id = ${workflows}.id
          AND ${workflowRuns}.id = ${toUuid(stranded.id)}
          AND ${workflowRuns}.graph = '{}'::jsonb
      `)

      const resumed = await resumeWorkflowRun(stranded.id)
      expect(resumed?.state).toBe('done')
      // The backfilled snapshot carries the real post-wait action, unlike the
      // stranded '{}' it replaced — a silent no-action 'done' (the bug the
      // backfill fixes) would leave this at 0.
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' })
    })
  })

  describe('conversational block layer (Phase C, slice C-1)', () => {
    /** A graph with one interactive reply_buttons node, matching graph.test.ts's
     *  fixture: two labeled branches, keyed by the button's own key. */
    function buttonsGraph(): WorkflowGraph {
      return {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'b',
            type: 'reply_buttons',
            body: { type: 'doc', content: [{ type: 'text', text: 'Pick one' }] },
            options: [
              { key: 'yes', label: 'Yes' },
              { key: 'no', label: 'No' },
            ],
            allowTyping: false,
          },
          { id: 'a_yes', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          { id: 'a_no', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'b' },
          { from: 'b', to: 'a_yes', branch: 'yes' },
          { from: 'b', to: 'a_no', branch: 'no' },
        ],
      } as WorkflowGraph
    }

    it('parks at an interactive block with an InputWaitCursor and schedules NO durable timer', async () => {
      applyAction.mockResolvedValueOnce({
        label: 'sent buttons block',
        blockMessageId: 'conversation_message_block1',
      })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask yes/no',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: buttonsGraph(),
      })

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('waiting')
      expect(run?.cursor).toMatchObject({
        waitKind: 'input',
        resumeNodeId: 'b', // the interactive node's OWN id, not a successor
        blockMessageId: 'conversation_message_block1',
        blockKind: 'buttons',
        allowTypingInterrupt: false,
      })
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toMatchObject({ type: 'send_block', nodeId: 'b' })
      // The defining behavior of an input wait: no BullMQ timer.
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run!.id))
      expect(events.map((e) => e.kind).sort()).toEqual(['started', 'waiting'])
    })

    it('resumes at the interactive node itself with a matching blockAnswer and routes by buttonKey', async () => {
      applyAction.mockResolvedValueOnce({
        label: 'sent buttons block',
        blockMessageId: 'conversation_message_block2',
      })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask yes/no',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: buttonsGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      applyAction.mockClear()

      const resumed = await resumeWorkflowRun(waiting!.id, {
        blockAnswer: { kind: 'buttons', buttonKey: 'no' },
      })
      expect(resumed?.state).toBe('done')
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' }) // the 'no' branch

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, waiting!.id))
      expect(events.map((e) => e.kind).sort()).toEqual(['completed', 'started', 'waiting'])
    })

    it('blockAnswer resume retry-safety: the atomic claim no-ops a second concurrent resume attempt', async () => {
      applyAction.mockResolvedValueOnce({
        label: 'sent buttons block',
        blockMessageId: 'conversation_message_block3',
      })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask yes/no',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: buttonsGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      applyAction.mockClear()

      // Two "attempts" at the same resume (e.g. a BullMQ-style retry, or
      // event-trigger.ts racing a second matching reply) — only the first
      // claim (waiting -> running) succeeds; the second sees the run already
      // claimed and no-ops, exactly like a timer-wait retry already does.
      const [first, second] = await Promise.all([
        resumeWorkflowRun(waiting!.id, { blockAnswer: { kind: 'buttons', buttonKey: 'yes' } }),
        resumeWorkflowRun(waiting!.id, { blockAnswer: { kind: 'buttons', buttonKey: 'yes' } }),
      ])
      const results = [first, second]
      expect(results.filter((r) => r !== null)).toHaveLength(1)
      expect(applyAction).toHaveBeenCalledTimes(1) // the 'yes' branch action ran exactly once

      const [after] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, waiting!.id))
      expect(after.state).toBe('done')
    })

    it('does not resume an input-wait run that was interrupted while parked (a teammate/free-text reply superseded it)', async () => {
      applyAction.mockResolvedValueOnce({
        label: 'sent buttons block',
        blockMessageId: 'conversation_message_block4',
      })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask yes/no',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: buttonsGraph(),
      })
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      applyAction.mockClear()

      expect(await interruptWaitingRuns(conversationId)).toBe(1)

      const resumed = await resumeWorkflowRun(waiting!.id, {
        blockAnswer: { kind: 'buttons', buttonKey: 'yes' },
      })
      expect(resumed).toBeNull()
      expect(applyAction).not.toHaveBeenCalled()
    })

    it('CSAT resume applies record_csat as the conversation VISITOR, not the run’s own service actor (amendment 1)', async () => {
      applyAction.mockResolvedValueOnce({
        label: 'sent csat block',
        blockMessageId: 'conversation_message_block5',
      })
      const conversationId = await seedConversation()
      const [{ visitorPrincipalId }] = await testDb
        .select({ visitorPrincipalId: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      const wf = await createWorkflow({
        name: 'Ask for a rating',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            {
              id: 'csat',
              type: 'request_csat',
              body: { type: 'doc', content: [{ type: 'text', text: 'Rate us' }] },
              allowTypingInterrupt: false,
            },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'csat' },
            { from: 'csat', to: 'a', branch: '5' },
          ],
        },
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      applyAction.mockClear()

      const resumed = await resumeWorkflowRun(waiting!.id, {
        blockAnswer: { kind: 'csat', rating: 5, comment: 'Great!' },
      })
      expect(resumed?.state).toBe('done')

      // Two actions this resume: record_csat (the rating), then the branch's close.
      expect(applyAction).toHaveBeenCalledTimes(2)
      const [csatAction, csatCtx] = applyAction.mock.calls[0]!
      expect(csatAction).toEqual({ type: 'record_csat', rating: 5, comment: 'Great!' })
      // The engine's own service actor has principalType 'service' and a null
      // principalId — record_csat's actor must be neither: it must resolve to
      // the conversation's real visitor (recordCsat requires the caller to BE
      // the visitor, and the resulting csat_submitted event needs a human
      // actor to legitimately trigger other workflows).
      expect(csatCtx.actor.principalType).not.toBe('service')
      expect(csatCtx.actor.principalId).toBe(visitorPrincipalId)

      expect(applyAction.mock.calls[1][0]).toEqual({ type: 'close' })
      // Every other action in the same resume still runs as the ordinary
      // workflow service actor.
      expect(applyAction.mock.calls[1][1].actor.principalType).toBe('service')
    })

    it('SF8: resolves send_block deps (assistant principal + variables) exactly ONCE for a plan with multiple chained send_block actions', async () => {
      vi.mocked(resolveWorkflowVariables).mockClear()
      vi.mocked(ensureAssistantPrincipal).mockClear()
      const conversationId = await seedConversation()
      // Two plain 'message' nodes in a row: each pushes its own send_block
      // action but neither parks (only the interactive kinds — buttons,
      // collect, collectReply, csat — park), so both land in ONE plan.
      const wf = await createWorkflow({
        name: 'Two messages then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            {
              id: 'm1',
              type: 'message',
              body: { type: 'doc', content: [{ type: 'text', text: 'First' }] },
            },
            {
              id: 'm2',
              type: 'message',
              body: { type: 'doc', content: [{ type: 'text', text: 'Second' }] },
            },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'm1' },
            { from: 'm1', to: 'm2' },
            { from: 'm2', to: 'a' },
          ],
        } as WorkflowGraph,
      })
      await setWorkflowStatus(wf.id, 'live')

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('done')

      // Three actions applied (two send_block + close), but the per-plan
      // deps resolved only once each — not once per send_block.
      expect(applyAction).toHaveBeenCalledTimes(3)
      expect(resolveWorkflowVariables).toHaveBeenCalledTimes(1)
      expect(resolveWorkflowVariables).toHaveBeenCalledWith(conversationId)
      expect(ensureAssistantPrincipal).toHaveBeenCalledTimes(1)
      // Both send_block calls received the SAME resolved deps object.
      const sendBlockCalls = applyAction.mock.calls.filter(
        (c: unknown[]) => (c[0] as { type: string }).type === 'send_block'
      )
      expect(sendBlockCalls).toHaveLength(2)
      expect(sendBlockCalls[0][1].resolvedBlockDeps).toBeDefined()
      expect(sendBlockCalls[0][1].resolvedBlockDeps).toBe(sendBlockCalls[1][1].resolvedBlockDeps)
    })

    it('SF8: a plan with NO send_block never resolves the block deps at all', async () => {
      vi.mocked(resolveWorkflowVariables).mockClear()
      vi.mocked(ensureAssistantPrincipal).mockClear()
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Just close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
      await setWorkflowStatus(wf.id, 'live')

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('done')

      expect(resolveWorkflowVariables).not.toHaveBeenCalled()
      expect(ensureAssistantPrincipal).not.toHaveBeenCalled()
      const [, callCtx] = applyAction.mock.calls[0]!
      expect(callCtx.resolvedBlockDeps).toBeUndefined()
    })
  })

  describe('let_assistant_answer parking (Phase C, slice C-6)', () => {
    /** A let_assistant_answer node with both a labeled escalated edge and an
     *  unlabeled default edge, each leading to a distinguishable action. */
    function assistantGraph(): WorkflowGraph {
      return {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'la', type: 'let_assistant_answer', instructions: 'Focus on billing only' },
          { id: 'a_default', type: 'action', action: { type: 'close' } },
          {
            id: 'a_escalated',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
        ],
        edges: [
          { from: 't', to: 'la' },
          { from: 'la', to: 'a_default' },
          { from: 'la', to: 'a_escalated', branch: 'escalated' },
        ],
      } as WorkflowGraph
    }

    it('parks with an assistant WaitCursor and schedules NO durable timer', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('waiting')
      expect(run?.cursor).toMatchObject({ waitKind: 'assistant', resumeNodeId: 'la' })
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({
        type: 'let_assistant_answer',
        instructions: 'Focus on billing only',
      })
      // The defining behavior of a non-timer wait: no BullMQ timer scheduled.
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run!.id))
      expect(events.map((e) => e.kind).sort()).toEqual(['started', 'waiting'])
    })

    it('resumes with outcome "escalated": follows the labeled escalated edge', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      applyAction.mockClear()

      const resumed = await resumeWorkflowRun(waiting!.id, { assistantOutcome: 'escalated' })
      expect(resumed?.state).toBe('done')
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'set_priority', priority: 'urgent' })
    })

    it('resumes with outcome "resolved": follows the unlabeled default edge', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      applyAction.mockClear()

      const resumed = await resumeWorkflowRun(waiting!.id, { assistantOutcome: 'resolved' })
      expect(resumed?.state).toBe('done')
      expect(applyAction).toHaveBeenCalledTimes(1)
      expect(applyAction.mock.calls[0][0]).toEqual({ type: 'close' })
    })

    it('assistantOutcome resume retry-safety: the atomic claim no-ops a second concurrent resume attempt', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      applyAction.mockClear()

      // Two "attempts" at the same resume (e.g. event-trigger.ts's
      // assistant.handed_off resume racing a close resume) — only the first
      // claim (waiting -> running) succeeds; the second sees the run already
      // claimed and no-ops, exactly like a blockAnswer/timer-wait retry.
      const [first, second] = await Promise.all([
        resumeWorkflowRun(waiting!.id, { assistantOutcome: 'escalated' }),
        resumeWorkflowRun(waiting!.id, { assistantOutcome: 'escalated' }),
      ])
      const results = [first, second]
      expect(results.filter((r) => r !== null)).toHaveLength(1)
      expect(applyAction).toHaveBeenCalledTimes(1)

      const [after] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, waiting!.id))
      expect(after.state).toBe('done')
    })

    it('does not resume an assistant-wait run that was interrupted while parked (a teammate takeover superseded it)', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()
      const wf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: assistantGraph(),
      })
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      applyAction.mockClear()

      expect(await interruptWaitingRuns(conversationId)).toBe(1)

      const resumed = await resumeWorkflowRun(waiting!.id, { assistantOutcome: 'escalated' })
      expect(resumed).toBeNull()
      expect(applyAction).not.toHaveBeenCalled()
    })
  })

  describe('interruptWaitingRuns cursor-aware exclusions (Phase C, slice C-6)', () => {
    it('excludeWaitKind leaves an assistant-wait run alone but still interrupts a plain timer wait on the same conversation', async () => {
      applyAction.mockResolvedValueOnce({ label: 'handed to assistant' })
      const conversationId = await seedConversation()

      const assistantWf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'la', type: 'let_assistant_answer' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'la' },
            { from: 'la', to: 'a' },
          ],
        },
      })
      const assistantWaiting = await runWorkflow(assistantWf, ctx(), { conversationId })
      expect(assistantWaiting?.cursor).toMatchObject({ waitKind: 'assistant' })

      const timerWf = await createWorkflow({
        name: 'wait then close',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      const timerWaiting = await runWorkflow(timerWf, ctx(), { conversationId })
      expect(timerWaiting?.cursor).toMatchObject({ waitKind: 'timer' })

      const interrupted = await interruptWaitingRuns(conversationId, {
        excludeWaitKind: 'assistant',
      })
      expect(interrupted).toBe(1) // only the timer wait

      const [assistantAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, assistantWaiting!.id))
      expect(assistantAfter.state).toBe('waiting') // untouched

      const [timerAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, timerWaiting!.id))
      expect(timerAfter.state).toBe('interrupted')
    })

    it('excludeRunId leaves the just-resumed run alone but still interrupts every other waiting run on the conversation', async () => {
      applyAction.mockResolvedValue({ label: 'handed to assistant' })
      const conversationId = await seedConversation()

      const assistantWf = await createWorkflow({
        name: 'Let Quinn answer',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'la', type: 'let_assistant_answer' },
            { id: 'w', type: 'wait', seconds: 60 },
          ],
          edges: [
            { from: 't', to: 'la' },
            { from: 'la', to: 'w' },
          ],
        },
      })
      await setWorkflowStatus(assistantWf.id, 'live')
      const assistantWaiting = await runWorkflow(assistantWf, ctx(), { conversationId })

      // Resolve it (close's resume-instead-of-interrupt) — it re-parks at the
      // wait node that follows on its default edge.
      const resumed = await resumeWorkflowRun(assistantWaiting!.id, {
        assistantOutcome: 'resolved',
      })
      expect(resumed?.state).toBe('waiting')
      expect(resumed?.cursor).toMatchObject({ waitKind: 'timer' })

      const otherWf = await createWorkflow({
        name: 'wait then close (background)',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      const otherWaiting = await runWorkflow(otherWf, ctx(), { conversationId })

      const interrupted = await interruptWaitingRuns(conversationId, {
        excludeRunId: resumed!.id,
      })
      expect(interrupted).toBe(1) // only the other background run

      const [resumedAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, resumed!.id))
      expect(resumedAfter.state).toBe('waiting') // untouched, still re-parked

      const [otherAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, otherWaiting!.id))
      expect(otherAfter.state).toBe('interrupted')
    })

    it('SF3: a close that resumes a run into a NEWLY-parked INPUT wait (not just a timer) survives the same close-triggered interrupt', async () => {
      // Mirrors event-trigger.ts's own close sequence exactly: resumeWorkflowRun
      // (via tryResumeAssistantWait) runs to completion — including any re-park
      // — BEFORE dispatchWorkflowsForEvent calls interruptWaitingRuns with
      // excludeRunId. The re-park landing on an 'input' wait (a CSAT/buttons
      // block a workflow posts right after resolving) rather than a plain
      // timer is the case the SF3 review flagged specifically: a post-close
      // CSAT survey must not be interrupted by the very close that triggered it.
      applyAction.mockResolvedValue({
        label: 'sent csat block',
        blockMessageId: 'conversation_message_postclose_csat',
      })
      const conversationId = await seedConversation()

      const assistantWf = await createWorkflow({
        name: 'Let Quinn answer, then CSAT',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'la', type: 'let_assistant_answer' },
            {
              id: 'csat',
              type: 'request_csat',
              body: { type: 'doc', content: [{ type: 'text', text: 'How did we do?' }] },
              allowTypingInterrupt: false,
            },
          ],
          edges: [
            { from: 't', to: 'la' },
            { from: 'la', to: 'csat' },
          ],
        },
      })
      await setWorkflowStatus(assistantWf.id, 'live')
      const assistantWaiting = await runWorkflow(assistantWf, ctx(), { conversationId })

      // The close's own resume-instead-of-interrupt (tryResumeAssistantWait's
      // equivalent call): resolves down the default edge into the CSAT block,
      // which parks fresh at an INPUT wait (not a timer).
      const resumed = await resumeWorkflowRun(assistantWaiting!.id, {
        assistantOutcome: 'resolved',
      })
      expect(resumed?.state).toBe('waiting')
      expect(resumed?.cursor).toMatchObject({
        waitKind: 'input',
        blockKind: 'csat',
        blockMessageId: 'conversation_message_postclose_csat',
      })

      const otherWf = await createWorkflow({
        name: 'idle auto-close timer (background)',
        class: 'background',
        triggerType: 'conversation.created',
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'w', type: 'wait', seconds: 60 },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [
            { from: 't', to: 'w' },
            { from: 'w', to: 'a' },
          ],
        },
      })
      const otherWaiting = await runWorkflow(otherWf, ctx(), { conversationId })

      // The close's own trailing interrupt call — same excludeRunId shape
      // dispatchWorkflowsForEvent passes.
      const interrupted = await interruptWaitingRuns(conversationId, { excludeRunId: resumed!.id })
      expect(interrupted).toBe(1) // only the sibling background timer

      const [resumedAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, resumed!.id))
      expect(resumedAfter.state).toBe('waiting') // the newly-parked input wait survives
      expect(resumedAfter.cursor).toMatchObject({ waitKind: 'input' })

      const [otherAfter] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, otherWaiting!.id))
      expect(otherAfter.state).toBe('interrupted')
    })
  })
})
