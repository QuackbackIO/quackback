/**
 * Workflow procedure steps: `call_tool` and `approval` (QUINN-PRODUCT P9).
 *
 * Real PostgreSQL inside the fixture's rollback. What is under test is the
 * boundary between the workflow engine and Quinn's own action machinery: the
 * receipt that makes one step's effect happen once however many times the step
 * is walked, the dial that decides whether a step may act without a person,
 * and the correlation that lets exactly one decision resume exactly one visit.
 *
 * Nothing here doubles a receipt, a proposal or a run row: those are the
 * mechanism. What is doubled is the workspace's assistant configuration read
 * (a settings read with nothing to do with procedure steps) and, for the
 * receipt case, the tool body itself, because "ran once" needs something that
 * counts and every real write tool's second run is indistinguishable from its
 * first.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { z } from 'zod'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantPendingActions,
  assistantToolCalls,
  conversations,
  principal,
  user,
  workflowRuns,
  eq,
} from '@/lib/server/db'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import type { AssistantToolRules } from '@/lib/shared/assistant/config'
import type { WorkflowGraph } from '../graph'
import { makeConditionContext } from './workflow-test-utils'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** The workspace's saved per-tool rules, which the resolver reads through. */
const { toolRules } = vi.hoisted(() => ({ toolRules: { current: {} as AssistantToolRules } }))
vi.mock('@/lib/server/domains/settings/settings.assistant', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/server/domains/settings/settings.assistant')>()
  return {
    ...original,
    getAssistantRuntimeConfig: vi.fn(async () => ({
      config: {
        ...DEFAULT_ASSISTANT_CONFIG,
        agents: {
          ...DEFAULT_ASSISTANT_CONFIG.agents,
          agent: { ...DEFAULT_ASSISTANT_CONFIG.agents.agent, toolRules: toolRules.current },
        },
      },
      revision: 1,
      workspaceName: 'Test',
    })),
  }
})
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
 * Every action except the two under test is recorded and skipped: which EDGE a
 * resume took is what the assertions read, and running a real close would drag
 * the conversation services and their realtime fan-out into this file.
 */
const { applyAction } = vi.hoisted(() => ({ applyAction: vi.fn() }))
vi.mock('../action.executor', async (importOriginal) => {
  const original = await importOriginal<typeof import('../action.executor')>()
  applyAction.mockImplementation(
    async (action: { type: string }, actionCtx: Parameters<typeof original.applyAction>[1]) =>
      action.type === 'call_tool' || action.type === 'request_approval'
        ? original.applyAction(action as Parameters<typeof original.applyAction>[0], actionCtx)
        : { label: action.type }
  )
  return { ...original, applyAction }
})

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { runWorkflow } from '../workflow.engine'
import { readCursor } from '../workflow-wait-queue'
import { completeWorkflowApproval } from '../workflow-approval'
import { resolveWorkflowToolStep, workflowToolStepKey } from '../workflow-tool-step'
import { executeReceiptedToolAction } from '@/lib/server/domains/assistant/assistant.tools'
import {
  makeAssistantToolContext,
  type AssistantToolSpec,
} from '@/lib/server/domains/assistant/assistant.toolspec'
import { resolveContentAudience } from '@/lib/server/domains/assistant/audience'
import { toolDefinition } from '@tanstack/ai'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
    await db.select({ id: assistantToolCalls.id }).from(assistantToolCalls).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConversation(): Promise<{
  conversationId: ConversationId
  principalId: PrincipalId
}> {
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
  return { conversationId: row.id, principalId }
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

function approvalGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 't', type: 'trigger' },
      {
        id: 'ap',
        type: 'approval',
        tool: 'end_conversation',
        args: { reason: 'The customer confirmed it is resolved' },
        summary: 'Close this conversation',
      },
      { id: 'a_approved', type: 'action', action: { type: 'add_note', body: 'approved' } },
      { id: 'a_declined', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
    ],
    edges: [
      { from: 't', to: 'ap' },
      { from: 'ap', to: 'a_approved' },
      { from: 'ap', to: 'a_declined', branch: 'declined' },
    ],
  } as WorkflowGraph
}

/** A write spec whose body counts, so "ran once" is an observation. */
function countingSpec(runs: { count: number }): AssistantToolSpec {
  return {
    name: 'counted_write',
    label: 'Counted write',
    description: 'A write whose executions are counted.',
    promptGuidance: 'Never offered to a model.',
    risk: 'write',
    permissions: [],
    parents: ['conversation'],
    definition: toolDefinition({
      name: 'counted_write',
      description: 'A write whose executions are counted.',
      inputSchema: z.object({ note: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
    }),
    execute: async () => {
      runs.count += 1
      return { ok: true }
    },
    summarize: () => 'Counted write',
  } as unknown as AssistantToolSpec
}

beforeEach(() => {
  toolRules.current = {}
  applyAction.mockClear()
})

describe.skipIf(!fixture.available)('workflow procedure steps', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('what a step is allowed to run', () => {
    it('refuses a tool that is not a built-in write tool', async () => {
      expect(
        await resolveWorkflowToolStep({ tool: 'nope', args: {}, requireAutonomous: true })
      ).toMatchObject({ ok: false, refusal: 'unknown_tool' })
      expect(
        await resolveWorkflowToolStep({ tool: 'search', args: {}, requireAutonomous: true })
      ).toMatchObject({ ok: false, refusal: 'not_a_write_tool' })
    })

    it('refuses a tool the workspace dial disabled, for both kinds', async () => {
      toolRules.current = { end_conversation: 'deny' }
      for (const requireAutonomous of [true, false]) {
        expect(
          await resolveWorkflowToolStep({
            tool: 'end_conversation',
            args: { reason: 'done' },
            requireAutonomous,
          })
        ).toMatchObject({ ok: false, refusal: 'tool_disabled' })
      }
    })

    it('refuses to run a needs-approval tool without a person, and allows proposing it', async () => {
      toolRules.current = { end_conversation: 'ask' }
      expect(
        await resolveWorkflowToolStep({
          tool: 'end_conversation',
          args: { reason: 'done' },
          requireAutonomous: true,
        })
      ).toMatchObject({ ok: false, refusal: 'needs_approval' })
      expect(
        await resolveWorkflowToolStep({
          tool: 'end_conversation',
          args: { reason: 'done' },
          requireAutonomous: false,
        })
      ).toMatchObject({ ok: true })
    })

    it('refuses arguments the tool contract rejects, before anything is dispatched', async () => {
      expect(
        await resolveWorkflowToolStep({
          tool: 'set_attribute',
          args: { nothing: 'useful' },
          requireAutonomous: true,
        })
      ).toMatchObject({ ok: false, refusal: 'invalid_arguments' })
    })

    it('fills workflow variables into a string argument', async () => {
      const resolved = await resolveWorkflowToolStep({
        tool: 'set_attribute',
        args: { key: 'tier', value: 'plan-{visitor_name}' },
        variables: { visitor_name: 'Ada' } as never,
        requireAutonomous: true,
      })
      expect(resolved).toMatchObject({ ok: true, args: { key: 'tier', value: 'plan-Ada' } })
    })
  })

  describe('a step runs once, however many times its visit is walked', () => {
    it('reads the first attempt receipt instead of dispatching again', async () => {
      const { conversationId, principalId } = await seedConversation()
      const runs = { count: 0 }
      const spec = countingSpec(runs)
      const actionKey = workflowToolStepKey('wfr_1', 'ct', 3)
      const toolCtx = makeAssistantToolContext({
        db: testDb,
        assistantPrincipalId: principalId,
        audience: resolveContentAudience('copilot'),
        conversationId,
      })

      const first = await executeReceiptedToolAction({
        spec,
        args: { note: 'once' },
        actionKey,
        ctx: toolCtx,
        conversationId,
      })
      expect(first.status).toBe('executed')

      const second = await executeReceiptedToolAction({
        spec,
        args: { note: 'once' },
        actionKey,
        ctx: toolCtx,
        conversationId,
      })
      expect(second).toMatchObject({ status: 'replayed', previous: { status: 'succeeded' } })

      // The effect happened exactly once, and there is exactly one receipt of
      // it: the action key is the claim, not a hint.
      expect(runs.count).toBe(1)
      const receipts = await testDb
        .select()
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.actionKey, actionKey))
      expect(receipts).toHaveLength(1)
      expect(receipts[0].outcomeStatus).toBe('succeeded')
    })

    it('keys the receipt by run, node and visit rather than by node alone', () => {
      expect(workflowToolStepKey('wfr_1', 'ct', 1)).toBe('workflow:wfr_1:ct:1')
      expect(workflowToolStepKey('wfr_1', 'ct', 2)).not.toBe(workflowToolStepKey('wfr_1', 'ct', 1))
      expect(workflowToolStepKey('wfr_2', 'ct', 1)).not.toBe(workflowToolStepKey('wfr_1', 'ct', 1))
    })
  })

  describe('an approval step', () => {
    it('opens one proposal and parks the run on it', async () => {
      const { conversationId } = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask before closing',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: approvalGraph(),
      })

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('waiting')
      const cursor = readCursor(run!)
      expect(cursor).toMatchObject({ waitKind: 'approval', resumeNodeId: 'ap', waitSeq: 1 })

      const proposals = await testDb
        .select()
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.conversationId, conversationId))
      expect(proposals).toHaveLength(1)
      expect(proposals[0].status).toBe('proposed')
      expect(proposals[0].toolName).toBe('end_conversation')
      expect(proposals[0].summary).toBe('Close this conversation')
      // The step identity, so a replayed park finds this proposal rather than
      // asking a second reviewer.
      expect(proposals[0].actionKey).toBe(workflowToolStepKey(run!.id, 'ap', 0))
      expect(cursor.pendingActionId).toBe(proposals[0].id)
      // Nothing ran: the whole point of the node is that a person decides.
      expect(applyAction.mock.calls.map((call) => call[0].type)).toEqual(['request_approval'])
    })

    it('takes the declined edge at once when no proposal could be opened', async () => {
      toolRules.current = { end_conversation: 'deny' }
      const { conversationId } = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask before closing',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: approvalGraph(),
      })

      const run = await runWorkflow(wf, ctx(), { conversationId })
      expect(run?.state).toBe('done')
      expect(applyAction.mock.calls.map((call) => call[0].type)).toEqual([
        'request_approval',
        'set_priority',
      ])
      expect(
        await testDb
          .select()
          .from(assistantPendingActions)
          .where(eq(assistantPendingActions.conversationId, conversationId))
      ).toHaveLength(0)
    })

    it('resumes the approved edge only for an executed decision', async () => {
      const { conversationId } = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask before closing',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: approvalGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const run = await runWorkflow(wf, ctx(), { conversationId })
      const proposalId = readCursor(run!).pendingActionId!

      expect(await completeWorkflowApproval(proposalId, 'executed')).toBe(true)
      const [after] = await testDb
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run!.id as never))
      expect(after.state).toBe('done')
      expect(applyAction.mock.calls.map((call) => call[0].type)).toEqual([
        'request_approval',
        'add_note',
      ])
    })

    it.each([['rejected'], ['expired'], ['failed'], ['unconfirmed'], ['refused']] as const)(
      'resumes the declined edge for %s, because none of those is the effect happening',
      async (reason) => {
        const { conversationId } = await seedConversation()
        const wf = await createWorkflow({
          name: 'Ask before closing',
          class: 'customer_facing',
          triggerType: 'conversation.created',
          graph: approvalGraph(),
        })
        await setWorkflowStatus(wf.id, 'live')
        const run = await runWorkflow(wf, ctx(), { conversationId })
        const proposalId = readCursor(run!).pendingActionId!

        expect(await completeWorkflowApproval(proposalId, reason)).toBe(true)
        expect(applyAction.mock.calls.map((call) => call[0].type)).toEqual([
          'request_approval',
          'set_priority',
        ])
      }
    )

    it('resumes nothing when the run has already moved past that visit', async () => {
      const { conversationId } = await seedConversation()
      const wf = await createWorkflow({
        name: 'Ask before closing',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: approvalGraph(),
      })
      await setWorkflowStatus(wf.id, 'live')
      const run = await runWorkflow(wf, ctx(), { conversationId })
      const proposalId = readCursor(run!).pendingActionId!

      expect(await completeWorkflowApproval(proposalId, 'executed')).toBe(true)
      // A second answer to the same question finds no parked run at all.
      expect(await completeWorkflowApproval(proposalId, 'rejected')).toBe(false)
    })
  })
})
