/**
 * Workflows pause after the plan limits grace on a plan without workflows.
 * No new run starts (from a trigger or by hand), and a run already parked at
 * a wait stops at that step boundary instead of resuming. The workflow keeps
 * its stored status, so everything starts again on upgrade with no setup.
 *
 * Real database for the runs, as in workflow.engine.test.ts; the plan state
 * comes from the shared feature-states double.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, workflowRuns, workflows, user, principal, eq } from '@/lib/server/db'
import { makeConditionContext } from './workflow-test-utils'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const { applyAction, scheduleWorkflowResume } = vi.hoisted(() => ({
  applyAction: vi.fn().mockResolvedValue('ok'),
  scheduleWorkflowResume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../action.executor', () => ({ applyAction }))
vi.mock('../workflow-wait-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workflow-wait-queue')>()),
  scheduleWorkflowResume,
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
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { runWorkflow, resumeWorkflowRun } from '../workflow.engine'
import {
  FEATURE_STATES,
  runsWithoutPlanGate,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

const fixture = await createDbTestFixture()

async function seedConversation(): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme visitor' })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  return row.id
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

/** A live workflow: one action, a wait, then one more action. */
async function liveWorkflow() {
  const wf = await createWorkflow({
    name: 'Acme escalate, wait, close',
    class: 'background',
    triggerType: 'conversation.created',
    graph: {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
        { id: 'w', type: 'wait', seconds: 60 },
        { id: 'a2', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'a1' },
        { from: 'a1', to: 'w' },
        { from: 'w', to: 'a2' },
      ],
    },
  })
  await setWorkflowStatus(wf.id, 'live')
  const [row] = await testDb.select().from(workflows).where(eq(workflows.id, wf.id))
  return row!
}

describe.skipIf(!fixture.available)('workflows and the plan limits pause (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    applyAction.mockClear()
    scheduleWorkflowResume.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it.each(FEATURE_STATES)('starts a run in the %s state only while not paused', async (state) => {
    const conversationId = await seedConversation()
    const wf = await liveWorkflow()
    setFeatureState(state, 'workflows')

    const run = await runWorkflow(wf, ctx(), { conversationId })

    const runs = await testDb
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.conversationId, conversationId))
    if (runsWithoutPlanGate(state)) {
      expect(run?.state).toBe('waiting')
      expect(runs).toHaveLength(1)
      expect(applyAction).toHaveBeenCalledOnce()
    } else {
      expect(run).toBeNull()
      expect(runs).toHaveLength(0)
      expect(applyAction).not.toHaveBeenCalled()
    }
  })

  it.each(FEATURE_STATES)(
    'stops a parked run at its next step in the %s state only while paused',
    async (state) => {
      const conversationId = await seedConversation()
      const wf = await liveWorkflow()
      setFeatureState('included', 'workflows')
      const waiting = await runWorkflow(wf, ctx(), { conversationId })
      expect(waiting?.state).toBe('waiting')
      applyAction.mockClear()

      setFeatureState(state, 'workflows')
      const resumed = await resumeWorkflowRun(waiting!.id)

      if (runsWithoutPlanGate(state)) {
        expect(resumed?.state).toBe('done')
        expect(applyAction).toHaveBeenCalledOnce()
      } else {
        expect(resumed?.state).toBe('interrupted')
        expect(applyAction).not.toHaveBeenCalled()
      }
      // The workflow's own stored status is never changed.
      const [row] = await testDb.select().from(workflows).where(eq(workflows.id, wf.id))
      expect(row?.status).toBe('live')
    }
  )
})
