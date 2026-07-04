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
} from '@/lib/server/db'
import type { ConditionContext } from '../condition.evaluator'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Spy the executor — the engine only orchestrates; action effects are tested
// against the real services elsewhere. vi.hoisted so it exists at mock-factory time.
const { applyAction } = vi.hoisted(() => ({ applyAction: vi.fn().mockResolvedValue('ok') }))
vi.mock('../action.executor', () => ({ applyAction }))

import { createWorkflow } from '../workflow.service'
import { runWorkflow } from '../workflow.engine'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

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

const ctx = (status = 'open'): ConditionContext => ({
  conversation: {
    status,
    channel: 'messenger',
    priority: 'none',
    waitingMinutes: null,
    tagIds: [],
  },
})

beforeEach(() => applyAction.mockClear())

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
    // Only the pre-wait action ran; the post-wait one waits for resume (Slice 5e).
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(applyAction.mock.calls[0][0]).toEqual({ type: 'set_priority', priority: 'urgent' })

    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run!.id))
    expect(events.map((e) => e.kind).sort()).toEqual(['started', 'waiting'])
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
})
