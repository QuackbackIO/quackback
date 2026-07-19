/**
 * Real-DB coverage for the workflow run sweeper (§4.6, durable-wait recovery).
 * Runs are seeded directly into workflow_runs (rather than driven through
 * runWorkflow) so each scenario controls the exact state/cursor/timestamps a
 * stranded row would have. The durable-timer side of things (getWorkflowWaitJob,
 * scheduleWorkflowResume) is mocked, same as the engine tests mock
 * scheduleWorkflowResume; workflowWaitJobId stays real so tests can rebuild the
 * job id a scheduled call would have used. Runs inside the fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  workflowRuns,
  workflowRunEvents,
  user,
  principal,
  eq,
} from '@/lib/server/db'
import type { WorkflowGraph } from '../graph'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The durable-timer queue is BullMQ; both of its accessors used by the sweep
// are spied here, keeping workflowWaitJobId real so tests can rebuild the job
// id a scheduled call would have used.
const { getWorkflowWaitJob, scheduleWorkflowResume } = vi.hoisted(() => ({
  getWorkflowWaitJob: vi.fn(),
  scheduleWorkflowResume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../workflow-wait-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workflow-wait-queue')>()),
  getWorkflowWaitJob,
  scheduleWorkflowResume,
}))

// The abandoned-journey auto-close pass's close half is mocked the same way
// action.executor.test.ts mocks it for the 'close' action: setConversationStatus's
// own side effects (system notice, SSE publish, async status_changed event) are
// tested elsewhere. Here only the DECISION (was it called, with what args) matters.
const { setConversationStatus, getWorkflowAbandonedAutoCloseSettings } = vi.hoisted(() => ({
  setConversationStatus: vi.fn().mockResolvedValue({}),
  getWorkflowAbandonedAutoCloseSettings: vi.fn(async () => ({
    enabled: true,
    waitMinutes: 5,
    keepIfEmailCaptured: true,
  })),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  setConversationStatus,
}))
vi.mock('@/lib/server/domains/settings/settings.workflows', () => ({
  getWorkflowAbandonedAutoCloseSettings,
}))

// The two timer-driven unresponsive triggers dispatch through
// events/dispatch.ts (which itself fans out via processEvent — a whole
// separate pipeline exercised elsewhere); here only WHICH synthetic event was
// raised, with what id/payload, matters.
const {
  dispatchConversationCustomerUnresponsive,
  dispatchConversationTeammateUnresponsive,
  dispatchSlaApproachingBreach,
  dispatchSlaBreached,
} = vi.hoisted(() => ({
  dispatchConversationCustomerUnresponsive: vi.fn().mockResolvedValue(undefined),
  dispatchConversationTeammateUnresponsive: vi.fn().mockResolvedValue(undefined),
  dispatchSlaApproachingBreach: vi.fn().mockResolvedValue(undefined),
  dispatchSlaBreached: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchConversationCustomerUnresponsive,
  dispatchConversationTeammateUnresponsive,
  dispatchSlaApproachingBreach,
  dispatchSlaBreached,
}))

// The SLA domain's own scan/claim correctness (fire-once markers, pause
// shifting, settle suppression) is covered by sla.service.timer-triggers.test.ts;
// here the orchestration is what's under test (which live workflows gate the
// scan, what lead time is resolved, how a scanned candidate becomes a dispatch
// call, and that the marker claim happens only AFTER a successful enqueue —
// claim-after-enqueue) so the underlying scans + claims are stubbed.
const { sweepApproachingSlaBreaches, sweepSlaBreachTriggers, claimSlaTimerTriggerMarker } =
  vi.hoisted(() => ({
    sweepApproachingSlaBreaches: vi.fn().mockResolvedValue([]),
    sweepSlaBreachTriggers: vi.fn().mockResolvedValue([]),
    claimSlaTimerTriggerMarker: vi.fn().mockResolvedValue(true),
  }))
vi.mock('@/lib/server/domains/sla/sla.sweep', () => ({
  sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers,
  claimSlaTimerTriggerMarker,
}))

// The ticket-anchored TTR twins — stubbed for the same reason as the
// conversation scans above (their own scan/claim correctness lives in
// ticket-sla.service.timer-triggers.test.ts).
const {
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  claimTicketSlaTimerTriggerMarker,
} = vi.hoisted(() => ({
  sweepApproachingTicketSlaBreaches: vi.fn().mockResolvedValue([]),
  sweepTicketSlaBreachTriggers: vi.fn().mockResolvedValue([]),
  claimTicketSlaTimerTriggerMarker: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/server/domains/sla/ticket-sla.sweep', () => ({
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  claimTicketSlaTimerTriggerMarker,
}))

import { createWorkflow } from '../workflow.service'
import {
  sweepStaleRunningRuns,
  sweepOrphanedWaitingRuns,
  sweepExpiredInputWaits,
  sweepUnresponsiveConversations,
  sweepSlaTimerTriggers,
  sweepWorkflowRuns,
} from '../workflow-sweep'
import { workflowWaitJobId } from '../workflow-wait-queue'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const emptyGraph: WorkflowGraph = { nodes: [], edges: [] }

async function seedConversation(opts: { visitorEmail?: string } = {}): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  // No email on the user/principal by default — resolveReplyRecipient then
  // falls through to `visitorEmail` (the conversation's own captured
  // column), which opts.visitorEmail lets a test seed directly.
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: principalId,
      channel: 'messenger',
      priority: 'none',
      visitorEmail: opts.visitorEmail ?? null,
    })
    .returning()
  return row.id
}

/** Insert a message directly (bypassing the messaging service, same idiom as
 *  conversation-unread-aggregate.test.ts's addMessage) so a test controls
 *  exactly whether/how a conversation has visitor engagement. */
async function addMessage(
  conversationId: ConversationId,
  senderType: 'agent' | 'visitor' | 'system' = 'visitor'
): Promise<void> {
  await testDb.insert(conversationMessages).values({ conversationId, senderType, content: 'msg' })
}

/** The EventConversationRef a plain seedConversation() row resolves to
 *  (status 'open' by default, channel 'messenger', priority 'none',
 *  unassigned) — matches the timer-trigger dispatch payload tests below,
 *  which don't change those columns. */
function conversationRef(conversationId: ConversationId) {
  return {
    id: conversationId,
    status: 'open',
    channel: 'messenger',
    priority: 'none',
    assignedTeamId: null,
  }
}

async function seedWorkflow(cls: 'customer_facing' | 'background' = 'background') {
  return createWorkflow({
    name: `sweep test ${suffix()}`,
    class: cls,
    triggerType: 'conversation.created',
    graph: emptyGraph,
  })
}

/** A live workflow subscribed to one of the timer-driven trigger types, with
 *  its own triggerSettings threshold. `createWorkflow` defaults to 'draft' —
 *  live is set explicitly via a second call since createWorkflow's own input
 *  has no status field. */
async function seedLiveTimerWorkflow(
  triggerType: string,
  triggerSettings: Record<string, unknown> = {}
) {
  const { setWorkflowStatus } = await import('../workflow.service')
  const wf = await createWorkflow({
    name: `timer trigger test ${suffix()}`,
    class: 'background',
    triggerType,
    triggerSettings,
    graph: emptyGraph,
  })
  return setWorkflowStatus(wf.id, 'live')
}

/** Directly set the conversation columns the unresponsive scan reads —
 *  bypassing the messaging service so a test pins the exact silence anchor
 *  and status a stranded conversation would have. */
async function setConversationSilence(
  conversationId: ConversationId,
  opts: { waitingSince: Date | null; lastMessageAt: Date; status?: 'open' | 'snoozed' | 'closed' }
): Promise<void> {
  await testDb
    .update(conversations)
    .set({
      waitingSince: opts.waitingSince,
      lastMessageAt: opts.lastMessageAt,
      status: opts.status ?? 'open',
    })
    .where(eq(conversations.id, conversationId))
}

beforeEach(() => {
  getWorkflowWaitJob.mockReset()
  scheduleWorkflowResume.mockClear()
  setConversationStatus.mockClear()
  setConversationStatus.mockResolvedValue({})
  getWorkflowAbandonedAutoCloseSettings.mockReset()
  getWorkflowAbandonedAutoCloseSettings.mockResolvedValue({
    enabled: true,
    waitMinutes: 5,
    keepIfEmailCaptured: true,
  })
  dispatchConversationCustomerUnresponsive.mockClear()
  dispatchConversationTeammateUnresponsive.mockClear()
  dispatchSlaApproachingBreach.mockClear()
  dispatchSlaBreached.mockClear()
  sweepApproachingSlaBreaches.mockReset().mockResolvedValue([])
  sweepSlaBreachTriggers.mockReset().mockResolvedValue([])
  claimSlaTimerTriggerMarker.mockReset().mockResolvedValue(true)
  sweepApproachingTicketSlaBreaches.mockReset().mockResolvedValue([])
  sweepTicketSlaBreachTriggers.mockReset().mockResolvedValue([])
  claimTicketSlaTimerTriggerMarker.mockReset().mockResolvedValue(true)
})

describe.skipIf(!fixture.available)('workflow run sweeper (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('sweepStaleRunningRuns', () => {
    it('settles a stale running run to interrupted, logs swept_stale, and releases the customer_facing lock', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow('customer_facing')
      const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000) // 20 min ago, past the 15 min threshold
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'running',
          customerFacing: true,
          startedAt: staleStartedAt,
        })
        .returning()

      const count = await sweepStaleRunningRuns(new Date())
      expect(count).toBe(1)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted')
      expect(after.endedAt).not.toBeNull()

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_stale'])

      // The lock is released: a fresh customer_facing run can now be inserted
      // for this conversation without hitting the partial unique index.
      await expect(
        testDb.insert(workflowRuns).values({
          workflowId: wf.id,
          conversationId,
          state: 'running',
          customerFacing: true,
        })
      ).resolves.toBeDefined()
    })

    it('leaves a running run younger than the stale threshold untouched', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'running',
          startedAt: new Date(Date.now() - 60 * 1000), // 1 min ago, well under the threshold
        })
        .returning()

      const count = await sweepStaleRunningRuns(new Date())
      expect(count).toBe(0)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('running')

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events).toHaveLength(0)
    })

    it('spares a run resumed from a long wait: ancient started_at but a fire time inside the stale window', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      // Parked hours ago at a 3-hour wait whose timer just fired: the worker
      // claimed it back to 'running' and it is legitimately mid-actions, even
      // though started_at is far past the SQL prefilter's threshold.
      const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000)
      const waitStartedAt = new Date(Date.now() - 3 * 60 * 60 * 1000 - 60 * 1000)
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 3 * 60 * 60, // fire time = ~1 min ago, well inside the stale window
        waitSeq: 1,
        waitStartedAt: waitStartedAt.toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'running', cursor, startedAt })
        .returning()

      const count = await sweepStaleRunningRuns(new Date())
      expect(count).toBe(0)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('running') // still executing, not swept

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events).toHaveLength(0)
    })

    it('sweeps a resumed run whose fire time is itself past the stale threshold', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      // Same shape as above, but the wait fired 20 minutes ago: on the
      // fire-time basis the resumed run has now been 'running' past the
      // threshold too, so it is presumed crashed post-resume and swept.
      const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000)
      const waitStartedAt = new Date(Date.now() - 3 * 60 * 60 * 1000 - 20 * 60 * 1000)
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 3 * 60 * 60, // fire time = 20 min ago, past the 15 min threshold
        waitSeq: 1,
        waitStartedAt: waitStartedAt.toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'running', cursor, startedAt })
        .returning()

      const count = await sweepStaleRunningRuns(new Date())
      expect(count).toBe(1)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted')

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_stale'])
    })

    it('spares a late-fired resume: fire time past the threshold but a recent claim-stamped resumedAt', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      // The timer was due 20 minutes ago but only just fired (queue backlog):
      // the claim stamped resumedAt, which is the run's real liveness marker.
      const startedAt = new Date(Date.now() - 60 * 60 * 1000)
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 600,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // fire time 20 min ago
        resumedAt: new Date(Date.now() - 60 * 1000).toISOString(), // claimed 1 min ago
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'running', cursor, startedAt })
        .returning()

      const count = await sweepStaleRunningRuns(new Date())
      expect(count).toBe(0)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('running') // legitimately mid-actions, not swept
    })

    it('settles and logs only once when two sweeps race the same stale run (guarded update no-ops for the loser)', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000)
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'running', startedAt: staleStartedAt })
        .returning()

      // Two overlapping sweep ticks (e.g. a slow tick still running when the
      // next fires) both select the row as stale and race to settle it. The
      // fixture's single connection serializes their guarded updates just
      // like Postgres would for any two concurrent writers: whichever lands
      // first flips state='running' away, and the loser's `WHERE state =
      // 'running'` predicate then matches zero rows — the same no-op path a
      // reply/close interrupting the run mid-sweep would hit.
      const [a, b] = await Promise.all([
        sweepStaleRunningRuns(new Date()),
        sweepStaleRunningRuns(new Date()),
      ])
      expect(a + b).toBe(1) // exactly one of the two counted it as swept

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted')

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_stale']) // no duplicate
    })
  })

  describe('sweepOrphanedWaitingRuns', () => {
    it('reschedules a waiting run whose durable timer is missing, clamping an already-elapsed wait to zero', async () => {
      getWorkflowWaitJob.mockResolvedValue(undefined) // no job in the queue: orphaned
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const waitStartedAt = new Date(Date.now() - 10 * 60 * 1000) // parked 10 min ago
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 60, // only a 60s wait, so it's long since elapsed
        waitSeq: 2,
        waitStartedAt: waitStartedAt.toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor })
        .returning()

      const now = new Date()
      const count = await sweepOrphanedWaitingRuns(now)
      expect(count).toBe(1)

      expect(getWorkflowWaitJob).toHaveBeenCalledWith(workflowWaitJobId(run.id, 2))
      expect(scheduleWorkflowResume).toHaveBeenCalledTimes(1)
      const [runId, remainingSeconds, seq] = scheduleWorkflowResume.mock.calls[0]
      expect(runId).toBe(run.id)
      expect(seq).toBe(2)
      expect(remainingSeconds).toBe(0) // elapsed wait clamps to zero, never negative

      // The cursor now reflects what was actually scheduled, so the next tick
      // looks up this exact job and its fire-time basis starts at the reschedule.
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.cursor).toEqual({
        resumeNodeId: 'a2',
        waitSeconds: 0,
        waitSeq: 2,
        waitStartedAt: now.toISOString(),
      })

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_rescheduled'])
    })

    it('leaves a waiting run whose durable timer job still exists untouched', async () => {
      getWorkflowWaitJob.mockResolvedValue({
        id: 'live-job',
        getState: async () => 'delayed',
      } as never) // job is queued, just late
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      // Overdue (fire time in the past) so the due-filter selects it — this is
      // the late-but-live job case, not a healthy future wait.
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 3600,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(0)
      expect(getWorkflowWaitJob).toHaveBeenCalledWith(workflowWaitJobId(run.id, 1))
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.cursor).toEqual(cursor) // untouched

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events).toHaveLength(0)
    })

    it('removes a settled failed job before rescheduling (frees the jobId reused by scheduleWorkflowResume)', async () => {
      const callOrder: string[] = []
      const removeJob = vi.fn(async () => {
        callOrder.push('remove')
      })
      getWorkflowWaitJob.mockResolvedValue({
        id: 'failed-job',
        getState: async () => 'failed',
        remove: removeJob,
      } as never)
      scheduleWorkflowResume.mockImplementationOnce(async () => {
        callOrder.push('reschedule')
      })
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 60,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(1)

      expect(removeJob).toHaveBeenCalledTimes(1)
      expect(scheduleWorkflowResume).toHaveBeenCalledTimes(1)
      // A settled job (removeOnFail/removeOnComplete still holding the id)
      // must be freed before scheduleWorkflowResume reuses the same
      // waitSeq-keyed jobId — otherwise BullMQ's add-with-existing-id is a
      // silent no-op and the run never actually gets a fresh timer.
      expect(callOrder).toEqual(['remove', 'reschedule'])

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_rescheduled'])
    })

    it('removes a settled completed job before rescheduling, same as the failed case', async () => {
      const callOrder: string[] = []
      const removeJob = vi.fn(async () => {
        callOrder.push('remove')
      })
      getWorkflowWaitJob.mockResolvedValue({
        id: 'completed-job',
        getState: async () => 'completed',
        remove: removeJob,
      } as never)
      scheduleWorkflowResume.mockImplementationOnce(async () => {
        callOrder.push('reschedule')
      })
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 60,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(1)

      expect(removeJob).toHaveBeenCalledTimes(1)
      expect(scheduleWorkflowResume).toHaveBeenCalledTimes(1)
      expect(callOrder).toEqual(['remove', 'reschedule'])

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_rescheduled'])
    })

    it('does not examine a waiting run whose wait is not yet due', async () => {
      getWorkflowWaitJob.mockResolvedValue(undefined)
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      // Healthy parked run: fire time an hour out. Even with its job missing,
      // it is not due yet — the sweep must not spend a queue lookup on it (and
      // with many parked runs, future waits must not crowd real orphans out of
      // the batch).
      const cursor = {
        resumeNodeId: 'a2',
        waitSeconds: 3600,
        waitSeq: 1,
        waitStartedAt: new Date().toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(0)
      expect(getWorkflowWaitJob).not.toHaveBeenCalled()
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events).toHaveLength(0)
    })

    it('falls back to the legacy job id and started_at for a run parked before the wait-sequence cursor existed, then converges', async () => {
      getWorkflowWaitJob.mockResolvedValue(undefined)
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000) // parked 2h ago, 1h wait: overdue
      const cursor = { resumeNodeId: 'a2', waitSeconds: 3600 } // legacy: no waitSeq, no waitStartedAt
      const [run] = await testDb
        .insert(workflowRuns)
        .values({ workflowId: wf.id, conversationId, state: 'waiting', cursor, startedAt })
        .returning()

      const now = new Date()
      const count = await sweepOrphanedWaitingRuns(now)
      expect(count).toBe(1)

      expect(getWorkflowWaitJob).toHaveBeenCalledWith(`workflow-wait:${run.id}`)
      expect(scheduleWorkflowResume).toHaveBeenCalledTimes(1)
      const [runId, remainingSeconds, seq] = scheduleWorkflowResume.mock.calls[0]
      expect(runId).toBe(run.id)
      expect(seq).toBe(1) // legacy cursor has no waitSeq, defaults to the first wait
      expect(remainingSeconds).toBe(0) // wait long elapsed, measured from started_at

      // The refresh upgrades the cursor to the sequence-keyed shape, so the
      // next tick checks the new job id and finds it — one reschedule, one
      // event, no perpetual re-sweeping of the same legacy run.
      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.cursor).toMatchObject({ resumeNodeId: 'a2', waitSeq: 1, waitSeconds: 0 })

      getWorkflowWaitJob.mockClear()
      getWorkflowWaitJob.mockResolvedValue({
        id: 'live-job',
        getState: async () => 'delayed',
      } as never)
      expect(await sweepOrphanedWaitingRuns(new Date())).toBe(0)
      expect(getWorkflowWaitJob).toHaveBeenCalledWith(workflowWaitJobId(run.id, 1))

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_rescheduled'])
    })

    it('never examines a parked input wait: no timer was ever scheduled for one', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow('customer_facing')
      // Parked long enough ago that a timer wait with the same waitStartedAt
      // would clearly be "due" — an input wait has waitSeconds: 0, so the SQL
      // due-filter alone would otherwise select it on every tick forever.
      const cursor = {
        waitKind: 'input',
        resumeNodeId: 'n1',
        blockMessageId: 'conversation_message_1',
        blockKind: 'buttons',
        allowTypingInterrupt: false,
        expiresAt: null,
        waitSeconds: 0,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          cursor,
          customerFacing: true,
        })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(0)
      expect(getWorkflowWaitJob).not.toHaveBeenCalled()
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting') // left parked, untouched
      expect(after.cursor).toEqual(cursor)
    })

    it('never examines a parked assistant wait either (Phase C, slice C-6): no timer was ever scheduled for one', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow('customer_facing')
      const cursor = {
        waitKind: 'assistant',
        resumeNodeId: 'la',
        waitSeconds: 0,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          cursor,
          customerFacing: true,
        })
        .returning()

      const count = await sweepOrphanedWaitingRuns(new Date())
      expect(count).toBe(0)
      expect(getWorkflowWaitJob).not.toHaveBeenCalled()
      expect(scheduleWorkflowResume).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting') // left parked, untouched
      expect(after.cursor).toEqual(cursor)
    })
  })

  describe('sweepExpiredInputWaits (abandoned-journey auto-close)', () => {
    /** An expired InputWaitCursor — expiresAt in the past, matching what the
     *  engine stamps at park time when the setting is enabled. */
    function expiredInputCursor(overrides: Record<string, unknown> = {}) {
      return {
        waitKind: 'input',
        resumeNodeId: 'n1',
        blockMessageId: 'conversation_message_block1',
        blockKind: 'buttons',
        allowTypingInterrupt: false,
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
        waitSeconds: 0,
        waitSeq: 1,
        waitStartedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        ...overrides,
      }
    }

    async function seedExpiredRun(
      conversationId: ConversationId,
      overrides: Record<string, unknown> = {}
    ) {
      const wf = await seedWorkflow('customer_facing')
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          customerFacing: true,
          cursor: expiredInputCursor(overrides),
        })
        .returning()
      return run
    }

    it('settles an expired never-engaged, no-email run to interrupted, logs swept_expired, and closes the conversation', async () => {
      const conversationId = await seedConversation()
      const run = await seedExpiredRun(conversationId)

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(1)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted')
      expect(after.endedAt).not.toBeNull()

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_expired'])

      // Never engaged (no visitor message) and no captured email: closed.
      expect(setConversationStatus).toHaveBeenCalledTimes(1)
      expect(setConversationStatus).toHaveBeenCalledWith(
        conversationId,
        'closed',
        expect.objectContaining({ principalType: 'service' })
      )
    })

    it('ends the run but leaves an engaged conversation open (a visitor message means a human should still see it)', async () => {
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'visitor')
      const run = await seedExpiredRun(conversationId)

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(1)

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted') // the run still ends...

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_expired'])

      expect(setConversationStatus).not.toHaveBeenCalled() // ...but the conversation stays open
    })

    it('leaves a never-engaged conversation open when an email was captured and keepIfEmailCaptured is on (default)', async () => {
      const conversationId = await seedConversation({ visitorEmail: 'visitor@example.com' })
      getWorkflowAbandonedAutoCloseSettings.mockResolvedValue({
        enabled: true,
        waitMinutes: 5,
        keepIfEmailCaptured: true,
      })
      await seedExpiredRun(conversationId)

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(1)
      expect(setConversationStatus).not.toHaveBeenCalled()
    })

    it('closes a never-engaged conversation with a captured email when keepIfEmailCaptured is off', async () => {
      const conversationId = await seedConversation({ visitorEmail: 'visitor@example.com' })
      getWorkflowAbandonedAutoCloseSettings.mockResolvedValue({
        enabled: true,
        waitMinutes: 5,
        keepIfEmailCaptured: false,
      })
      await seedExpiredRun(conversationId)

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(1)
      expect(setConversationStatus).toHaveBeenCalledWith(
        conversationId,
        'closed',
        expect.anything()
      )
    })

    it('leaves an already-closed conversation alone (no redundant close)', async () => {
      const conversationId = await seedConversation()
      await testDb
        .update(conversations)
        .set({ status: 'closed' })
        .where(eq(conversations.id, conversationId))
      await seedExpiredRun(conversationId)

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(1) // the run still ends...
      expect(setConversationStatus).not.toHaveBeenCalled() // ...but no redundant close call
    })

    it('never examines a parked assistant wait, even with a stray expiresAt in its cursor', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow('customer_facing')
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          customerFacing: true,
          cursor: {
            waitKind: 'assistant',
            resumeNodeId: 'la',
            waitSeconds: 0,
            waitSeq: 1,
            waitStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            // An assistant wait never carries this field in practice (the
            // engine only stamps expiresAt onto an 'input' cursor) — present
            // here defensively to prove the sweep gates on waitKind, not
            // merely on expiresAt's presence.
            expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
          },
        })
        .returning()

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(0)
      expect(setConversationStatus).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting') // left parked, untouched
    })

    it('never examines a plain timer wait (no waitKind, no expiresAt)', async () => {
      const conversationId = await seedConversation()
      const wf = await seedWorkflow()
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          conversationId,
          state: 'waiting',
          cursor: {
            resumeNodeId: 'a2',
            waitSeconds: 3600,
            waitSeq: 1,
            waitStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        })
        .returning()

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(0)
      expect(setConversationStatus).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting')
    })

    it('does not examine an input wait whose expiry has not yet passed', async () => {
      const conversationId = await seedConversation()
      const run = await seedExpiredRun(conversationId, {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // an hour from now
      })

      const count = await sweepExpiredInputWaits(new Date())
      expect(count).toBe(0)
      expect(setConversationStatus).not.toHaveBeenCalled()

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('waiting')
    })

    it('settles and closes only once when two sweeps race the same expired run (guarded settle no-ops for the loser)', async () => {
      const conversationId = await seedConversation()
      const run = await seedExpiredRun(conversationId)

      const [a, b] = await Promise.all([
        sweepExpiredInputWaits(new Date()),
        sweepExpiredInputWaits(new Date()),
      ])
      expect(a + b).toBe(1) // exactly one of the two counted it as swept

      const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      expect(after.state).toBe('interrupted')

      const events = await testDb
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, run.id))
      expect(events.map((e) => e.kind)).toEqual(['swept_expired']) // no duplicate

      // The loser's guarded update affected zero rows, so it never reached
      // the close decision at all — exactly one close, not two.
      expect(setConversationStatus).toHaveBeenCalledTimes(1)
    })
  })

  describe('sweepUnresponsiveConversations', () => {
    it('fires conversation.teammate_unresponsive when the last message is from the customer and the threshold has just passed', async () => {
      const wf = await seedLiveTimerWorkflow('conversation.teammate_unresponsive', {
        inactivityMinutes: 60,
      })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'visitor')
      const waitingSince = new Date(Date.now() - 65 * 60 * 1000) // 65 min of silence, threshold 60
      await setConversationSilence(conversationId, { waitingSince, lastMessageAt: waitingSince })

      const fired = await sweepUnresponsiveConversations(new Date())
      expect(fired).toBe(1)
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledTimes(1)
      const [jobId, payload] = dispatchConversationTeammateUnresponsive.mock.calls[0]
      expect(jobId).toBe(
        `timer:conversation.teammate_unresponsive:${wf.id}:${conversationId}:${waitingSince.toISOString()}`
      )
      expect(payload).toMatchObject({
        conversationId,
        // The webhook payload contract every sibling conversation event
        // embeds (EventConversationRef) — see events/types.ts's
        // ConversationUnresponsivePayload doc.
        conversation: conversationRef(conversationId),
        workflowId: wf.id,
        sinceAt: waitingSince.toISOString(),
      })
      expect(dispatchConversationCustomerUnresponsive).not.toHaveBeenCalled()
    })

    it('fires conversation.customer_unresponsive when the last message is from a teammate/assistant', async () => {
      await seedLiveTimerWorkflow('conversation.customer_unresponsive', {
        inactivityMinutes: 30,
      })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'agent')
      const lastMessageAt = new Date(Date.now() - 35 * 60 * 1000) // 35 min, threshold 30
      await setConversationSilence(conversationId, { waitingSince: null, lastMessageAt })

      const fired = await sweepUnresponsiveConversations(new Date())
      expect(fired).toBe(1)
      expect(dispatchConversationCustomerUnresponsive).toHaveBeenCalledTimes(1)
      expect(dispatchConversationTeammateUnresponsive).not.toHaveBeenCalled()
    })

    it('an assistant reply disarms teammate_unresponsive and arms customer_unresponsive instead (waitingSince cleared)', async () => {
      // Mirrors appendAssistantReply's own write (senderType 'agent',
      // waitingSince: null) — see conversation.service.ts's doc: an
      // assistant answer counts as a response for this rule, same as a human
      // teammate's.
      const customerWf = await seedLiveTimerWorkflow('conversation.customer_unresponsive', {
        inactivityMinutes: 20,
      })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'agent') // stands in for the assistant's own reply
      const lastMessageAt = new Date(Date.now() - 25 * 60 * 1000)
      await setConversationSilence(conversationId, { waitingSince: null, lastMessageAt })

      const fired = await sweepUnresponsiveConversations(new Date())
      expect(fired).toBe(1)
      expect(dispatchConversationCustomerUnresponsive).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowId: customerWf.id })
      )
    })

    it('never fires on a closed or snoozed conversation', async () => {
      await seedLiveTimerWorkflow('conversation.teammate_unresponsive', { inactivityMinutes: 10 })
      const closed = await seedConversation()
      const snoozed = await seedConversation()
      await addMessage(closed, 'visitor')
      await addMessage(snoozed, 'visitor')
      const waitingSince = new Date(Date.now() - 20 * 60 * 1000)
      await setConversationSilence(closed, {
        waitingSince,
        lastMessageAt: waitingSince,
        status: 'closed',
      })
      await setConversationSilence(snoozed, {
        waitingSince,
        lastMessageAt: waitingSince,
        status: 'snoozed',
      })

      const fired = await sweepUnresponsiveConversations(new Date())
      expect(fired).toBe(0)
      expect(dispatchConversationTeammateUnresponsive).not.toHaveBeenCalled()
    })

    it("respects each live workflow's own threshold independently", async () => {
      const shortWf = await seedLiveTimerWorkflow('conversation.teammate_unresponsive', {
        inactivityMinutes: 10,
      })
      await seedLiveTimerWorkflow('conversation.teammate_unresponsive', {
        inactivityMinutes: 120,
      })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'visitor')
      // 12 minutes of silence: inside the 10-minute workflow's crossing
      // window (threshold 10, +15 min slack -> [10, 25)) but nowhere near
      // crossing the 120-minute one.
      const waitingSince = new Date(Date.now() - 12 * 60 * 1000)
      await setConversationSilence(conversationId, { waitingSince, lastMessageAt: waitingSince })

      const fired = await sweepUnresponsiveConversations(new Date())
      expect(fired).toBe(1)
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledTimes(1)
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowId: shortWf.id })
      )
    })

    it('does not fire before the threshold is reached', async () => {
      await seedLiveTimerWorkflow('conversation.teammate_unresponsive', { inactivityMinutes: 60 })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'visitor')
      const waitingSince = new Date(Date.now() - 5 * 60 * 1000) // only 5 min of silence
      await setConversationSilence(conversationId, { waitingSince, lastMessageAt: waitingSince })

      expect(await sweepUnresponsiveConversations(new Date())).toBe(0)
    })

    it('dedupes across two sweep ticks over the same continuous silence period (same jobId)', async () => {
      const wf = await seedLiveTimerWorkflow('conversation.teammate_unresponsive', {
        inactivityMinutes: 60,
      })
      const conversationId = await seedConversation()
      await addMessage(conversationId, 'visitor')
      const waitingSince = new Date(Date.now() - 61 * 60 * 1000)
      await setConversationSilence(conversationId, { waitingSince, lastMessageAt: waitingSince })

      await sweepUnresponsiveConversations(new Date())
      await sweepUnresponsiveConversations(new Date(Date.now() + 60 * 1000)) // next tick, same silence period
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledTimes(2)
      const [firstJobId] = dispatchConversationTeammateUnresponsive.mock.calls[0]
      const [secondJobId] = dispatchConversationTeammateUnresponsive.mock.calls[1]
      // Same anchor -> same deterministic id both ticks; BullMQ's own jobId
      // dedupe (not exercised here, dispatch is mocked) is what actually
      // collapses these into one job downstream.
      expect(firstJobId).toBe(secondJobId)
      expect(firstJobId).toContain(wf.id)
    })

    it('one failed dispatch does not stop the rest of the batch (bounded-concurrency fan-out)', async () => {
      await seedLiveTimerWorkflow('conversation.teammate_unresponsive', { inactivityMinutes: 60 })
      const waitingSince = new Date(Date.now() - 61 * 60 * 1000)
      const failingConversationId = await seedConversation()
      await addMessage(failingConversationId, 'visitor')
      await setConversationSilence(failingConversationId, {
        waitingSince,
        lastMessageAt: waitingSince,
      })
      const okConversationId = await seedConversation()
      await addMessage(okConversationId, 'visitor')
      await setConversationSilence(okConversationId, { waitingSince, lastMessageAt: waitingSince })

      dispatchConversationTeammateUnresponsive.mockImplementation(async (_jobId, payload) => {
        if (payload.conversationId === failingConversationId) {
          throw new Error('transient dispatch failure')
        }
      })

      const fired = await sweepUnresponsiveConversations(new Date())
      // Only the successful one counts, but the batch still ran both — the
      // failing conversation's dispatch attempt didn't stop its sibling.
      expect(fired).toBe(1)
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledTimes(2)
      expect(dispatchConversationTeammateUnresponsive).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ conversationId: okConversationId })
      )
    })
  })

  describe('sweepSlaTimerTriggers', () => {
    it('does nothing when no live workflow subscribes to either SLA trigger', async () => {
      const fired = await sweepSlaTimerTriggers(new Date())
      expect(fired).toBe(0)
      expect(sweepApproachingSlaBreaches).not.toHaveBeenCalled()
      expect(sweepSlaBreachTriggers).not.toHaveBeenCalled()
      // The ticket-axis scans share the same live-workflow pre-check.
      expect(sweepApproachingTicketSlaBreaches).not.toHaveBeenCalled()
      expect(sweepTicketSlaBreachTriggers).not.toHaveBeenCalled()
    })

    it('resolves the widest breachLeadMinutes across live approaching_breach workflows and dispatches each scanned candidate, claiming the marker after the enqueue', async () => {
      await seedLiveTimerWorkflow('sla.approaching_breach', { breachLeadMinutes: 10 })
      await seedLiveTimerWorkflow('sla.approaching_breach', { breachLeadMinutes: 30 })
      const conversationId = await seedConversation()
      const candidate = {
        conversationId,
        conversation: conversationRef(conversationId),
        policyId: 'sla_policy_1',
        clock: 'first_response',
        dueAt: '2026-01-05T11:00:00.000Z',
        appliedAt: '2026-01-05T10:00:00.000Z',
      }
      sweepApproachingSlaBreaches.mockResolvedValue([candidate])

      const now = new Date('2026-01-05T10:35:00Z')
      const fired = await sweepSlaTimerTriggers(now)
      expect(fired).toBe(1)
      expect(sweepApproachingSlaBreaches).toHaveBeenCalledWith(30, expect.any(Date))
      expect(dispatchSlaApproachingBreach).toHaveBeenCalledWith(
        expect.stringContaining(`timer:sla.approaching_breach:${conversationId}`),
        {
          conversationId,
          conversation: conversationRef(conversationId),
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00.000Z',
        }
      )
      // Claim-after-enqueue: the fire-once marker is claimed only after the
      // dispatch was enqueued, with the sweep's `now`.
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledWith(candidate, 'warning', now)
    })

    it('dispatches sla.breached for each scanned candidate only when a live workflow subscribes', async () => {
      await seedLiveTimerWorkflow('sla.breached', {})
      const conversationId = await seedConversation()
      const candidate = {
        conversationId,
        conversation: conversationRef(conversationId),
        policyId: 'sla_policy_1',
        clock: 'resolution',
        dueAt: '2026-01-05T09:00:00.000Z',
        appliedAt: '2026-01-05T08:00:00.000Z',
      }
      sweepSlaBreachTriggers.mockResolvedValue([candidate])

      const now = new Date()
      const fired = await sweepSlaTimerTriggers(now)
      expect(fired).toBe(1)
      expect(dispatchSlaBreached).toHaveBeenCalledWith(expect.any(String), {
        conversationId,
        conversation: conversationRef(conversationId),
        clock: 'resolution',
        dueAt: '2026-01-05T09:00:00.000Z',
      })
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledWith(candidate, 'breach', now)
    })

    it('one failed sla.breached dispatch does not stop the rest of the scanned batch — and leaves its own marker unclaimed', async () => {
      await seedLiveTimerWorkflow('sla.breached', {})
      const failingConversationId = await seedConversation()
      const okConversationId = await seedConversation()
      const failing = {
        conversationId: failingConversationId,
        conversation: conversationRef(failingConversationId),
        policyId: 'sla_policy_1',
        clock: 'resolution',
        dueAt: '2026-01-05T09:00:00.000Z',
        appliedAt: '2026-01-05T08:00:00.000Z',
      }
      const ok = { ...failing, conversationId: okConversationId }
      sweepSlaBreachTriggers.mockResolvedValue([failing, ok])
      dispatchSlaBreached.mockImplementation(async (_jobId, payload) => {
        if (payload.conversationId === failingConversationId) throw new Error('transient failure')
      })

      const fired = await sweepSlaTimerTriggers(new Date())
      expect(fired).toBe(1)
      expect(dispatchSlaBreached).toHaveBeenCalledTimes(2)
      expect(dispatchSlaBreached).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ conversationId: okConversationId })
      )
      // Only the successfully enqueued candidate gets its marker claimed.
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledTimes(1)
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: okConversationId }),
        'breach',
        expect.any(Date)
      )
    })

    it('a failed enqueue leaves the marker unclaimed so the next tick re-scans and retries (A4)', async () => {
      await seedLiveTimerWorkflow('sla.breached', {})
      const conversationId = await seedConversation()
      const candidate = {
        conversationId,
        conversation: conversationRef(conversationId),
        policyId: 'sla_policy_1',
        clock: 'first_response',
        dueAt: '2026-01-05T11:00:00.000Z',
        appliedAt: '2026-01-05T10:00:00.000Z',
      }
      // The marker is never claimed while the enqueue fails, so the scan
      // keeps re-finding the candidate on later ticks.
      sweepSlaBreachTriggers.mockResolvedValue([candidate])
      dispatchSlaBreached.mockRejectedValueOnce(new Error('queue down'))

      const firstTick = await sweepSlaTimerTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(firstTick).toBe(0)
      expect(claimSlaTimerTriggerMarker).not.toHaveBeenCalled()

      const secondTick = await sweepSlaTimerTriggers(new Date('2026-01-05T11:10:00Z'))
      expect(secondTick).toBe(1)
      expect(dispatchSlaBreached).toHaveBeenCalledTimes(2)
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledTimes(1)
      expect(claimSlaTimerTriggerMarker).toHaveBeenCalledWith(
        candidate,
        'breach',
        new Date('2026-01-05T11:10:00Z')
      )
    })

    // --- Ticket-anchored TTR candidates (ticket-sla.sweep.ts) ride the same
    // trigger types, extended with the ticket identity. The scans already
    // filter out back-office tickets, so every candidate here dispatches. ---

    /** A scanned ticket-clock candidate, shaped like
     *  ticket-sla.sweep.ts's TicketSlaTimerTriggerCandidate. */
    function ticketCandidate(overrides: Record<string, unknown> = {}) {
      const ticketId = 'ticket_abc'
      const conversationId = 'conversation_xyz'
      return {
        conversationId,
        conversation: {
          id: conversationId,
          status: 'open',
          channel: 'messenger',
          priority: 'none',
          assignedTeamId: null,
        },
        ticketId,
        ticket: {
          id: ticketId,
          number: 42,
          type: 'customer',
          priority: 'none',
          assignedPrincipalId: null,
          assignedTeamId: null,
        },
        policyId: 'sla_policy_1',
        clock: 'time_to_resolve',
        dueAt: '2026-01-05T11:00:00.000Z',
        appliedAt: '2026-01-05T10:00:00.000Z',
        ...overrides,
      }
    }

    it('dispatches sla.approaching_breach for a scanned ticket candidate with the ticket identity and a ticket-keyed jobId, claiming after the enqueue', async () => {
      await seedLiveTimerWorkflow('sla.approaching_breach', { breachLeadMinutes: 20 })
      const candidate = ticketCandidate()
      sweepApproachingTicketSlaBreaches.mockResolvedValue([candidate])

      const now = new Date('2026-01-05T10:45:00Z')
      const fired = await sweepSlaTimerTriggers(now)
      expect(fired).toBe(1)
      // The same lead resolution feeds the ticket scan as the conversation one.
      expect(sweepApproachingTicketSlaBreaches).toHaveBeenCalledWith(20, expect.any(Date))
      expect(dispatchSlaApproachingBreach).toHaveBeenCalledWith(
        `timer:sla.approaching_breach:ticket:${candidate.ticketId}:${candidate.clock}:${candidate.dueAt}`,
        {
          conversationId: candidate.conversationId,
          conversation: candidate.conversation,
          clock: 'time_to_resolve',
          dueAt: candidate.dueAt,
          ticketId: candidate.ticketId,
          ticket: candidate.ticket,
        }
      )
      expect(claimTicketSlaTimerTriggerMarker).toHaveBeenCalledWith(candidate, 'warning', now)
    })

    it('dispatches sla.breached for a scanned ticket candidate with the ticket identity and a ticket-keyed jobId', async () => {
      await seedLiveTimerWorkflow('sla.breached', {})
      const candidate = ticketCandidate()
      sweepTicketSlaBreachTriggers.mockResolvedValue([candidate])

      const now = new Date()
      const fired = await sweepSlaTimerTriggers(now)
      expect(fired).toBe(1)
      expect(dispatchSlaBreached).toHaveBeenCalledWith(
        `timer:sla.breached:ticket:${candidate.ticketId}:${candidate.clock}:${candidate.dueAt}`,
        {
          conversationId: candidate.conversationId,
          conversation: candidate.conversation,
          clock: 'time_to_resolve',
          dueAt: candidate.dueAt,
          ticketId: candidate.ticketId,
          ticket: candidate.ticket,
        }
      )
      expect(claimTicketSlaTimerTriggerMarker).toHaveBeenCalledWith(candidate, 'breach', now)
    })

    it('one failed ticket dispatch does not stop the rest of the scanned ticket batch — and leaves its own marker unclaimed', async () => {
      await seedLiveTimerWorkflow('sla.breached', {})
      const failing = ticketCandidate({ ticketId: 'ticket_bad' })
      const ok = ticketCandidate({ ticketId: 'ticket_ok' })
      sweepTicketSlaBreachTriggers.mockResolvedValue([failing, ok])
      dispatchSlaBreached.mockImplementation(async (_jobId, payload) => {
        if (payload.ticketId === 'ticket_bad') throw new Error('transient failure')
      })

      const fired = await sweepSlaTimerTriggers(new Date())
      expect(fired).toBe(1)
      expect(dispatchSlaBreached).toHaveBeenCalledTimes(2)
      expect(dispatchSlaBreached).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ ticketId: 'ticket_ok' })
      )
      expect(claimTicketSlaTimerTriggerMarker).toHaveBeenCalledTimes(1)
      expect(claimTicketSlaTimerTriggerMarker).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'ticket_ok' }),
        'breach',
        expect.any(Date)
      )
    })
  })

  describe('sweepWorkflowRuns', () => {
    it('runs every pass without throwing when there is nothing to sweep', async () => {
      getWorkflowWaitJob.mockResolvedValue(undefined)
      await expect(sweepWorkflowRuns()).resolves.toBeUndefined()
    })
  })
})
