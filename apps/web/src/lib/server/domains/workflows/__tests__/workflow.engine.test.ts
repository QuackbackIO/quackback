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
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  workflowRuns,
  workflowRunEvents,
  user,
  principal,
  eq,
  and,
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

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { runWorkflow, resumeWorkflowRun, interruptWaitingRuns } from '../workflow.engine'
import { workflowWaitJobId } from '../workflow-wait-queue'
import { resolveConditionContext } from '../condition.context'

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
})
