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

import { createWorkflow } from '../workflow.service'
import {
  sweepStaleRunningRuns,
  sweepOrphanedWaitingRuns,
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

async function seedConversation(): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  return row.id
}

async function seedWorkflow(cls: 'customer_facing' | 'background' = 'background') {
  return createWorkflow({
    name: `sweep test ${suffix()}`,
    class: cls,
    triggerType: 'conversation.created',
    graph: emptyGraph,
  })
}

beforeEach(() => {
  getWorkflowWaitJob.mockReset()
  scheduleWorkflowResume.mockClear()
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
      getWorkflowWaitJob.mockResolvedValue({ id: 'live-job' } as never) // job is queued, just late
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
      getWorkflowWaitJob.mockResolvedValue({ id: 'live-job' } as never)
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

  describe('sweepWorkflowRuns', () => {
    it('runs both passes without throwing when there is nothing to sweep', async () => {
      getWorkflowWaitJob.mockResolvedValue(undefined)
      await expect(sweepWorkflowRuns()).resolves.toBeUndefined()
    })
  })
})
