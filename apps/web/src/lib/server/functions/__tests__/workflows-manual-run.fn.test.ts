/**
 * Manual workflow runs (inbox action): listRunnableWorkflowsFn +
 * runWorkflowManuallyFn. Mirrors workflows-class-guard.test.ts's directly-
 * callable createServerFn shim, with the real zod validator applied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Workflow } from '@/lib/server/db'
import type { ConditionContext } from '@/lib/server/domains/workflows/condition.evaluator'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  resolveConditionContext: vi.fn(),
  hasActiveCustomerFacingRun: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  listWorkflows: hoisted.listWorkflows,
  getWorkflow: hoisted.getWorkflow,
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  setWorkflowStatus: vi.fn(),
  softDeleteWorkflow: vi.fn(),
}))
vi.mock('@/lib/server/domains/workflows/workflow-versions', () => ({
  listWorkflowVersions: vi.fn(),
  getWorkflowVersion: vi.fn(),
}))
vi.mock('@/lib/server/domains/workflows/workflow-preview', () => ({
  previewWorkflow: vi.fn(),
}))
vi.mock('@/lib/server/domains/workflows/workflow.engine', () => ({
  runWorkflow: hoisted.runWorkflow,
}))
vi.mock('@/lib/server/domains/workflows/condition.context', () => ({
  resolveConditionContext: hoisted.resolveConditionContext,
}))
vi.mock('@/lib/server/domains/workflows/dispatcher.guards', () => ({
  hasActiveCustomerFacingRun: hoisted.hasActiveCustomerFacingRun,
}))

import { listRunnableWorkflowsFn, runWorkflowManuallyFn } from '../workflows'

function makeWorkflow(extra: Partial<Workflow> = {}): Workflow {
  return {
    id: 'workflow_1',
    name: 'Escalate to billing',
    class: 'background',
    status: 'live',
    sortOrder: 0,
    triggerType: 'conversation.created',
    triggerSettings: {},
    graph: { nodes: [], edges: [] },
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...extra,
  } as Workflow
}

const ctx = {} as ConditionContext

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
})

describe('listRunnableWorkflowsFn', () => {
  it('gates on conversation.reply', async () => {
    hoisted.listWorkflows.mockResolvedValue([])
    await listRunnableWorkflowsFn()
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'conversation.reply' })
  })

  it('returns only live workflows, as the minimal DTO', async () => {
    hoisted.listWorkflows.mockResolvedValue([
      makeWorkflow({ id: 'workflow_live', status: 'live', name: 'Live one' }),
      makeWorkflow({ id: 'workflow_draft', status: 'draft', name: 'Draft one' }),
      makeWorkflow({ id: 'workflow_paused', status: 'paused', name: 'Paused one' }),
    ])

    const result = await listRunnableWorkflowsFn()

    expect(result).toEqual([
      {
        id: 'workflow_live',
        name: 'Live one',
        class: 'background',
        triggerType: 'conversation.created',
      },
    ])
  })
})

describe('runWorkflowManuallyFn', () => {
  it('gates on conversation.reply', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockResolvedValue({ id: 'workflow_run_1', state: 'done' })

    await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'conversation.reply' })
  })

  it('reports not_live when the workflow is missing', async () => {
    hoisted.getWorkflow.mockResolvedValue(null)

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'not_live' })
    expect(hoisted.runWorkflow).not.toHaveBeenCalled()
  })

  it('reports not_live when the workflow is draft/paused', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ status: 'paused' }))

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'not_live' })
    expect(hoisted.resolveConditionContext).not.toHaveBeenCalled()
  })

  it('reports locked when a customer_facing run is already active, without calling runWorkflow', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'customer_facing' }))
    hoisted.hasActiveCustomerFacingRun.mockResolvedValue(true)

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'locked' })
    expect(hoisted.resolveConditionContext).not.toHaveBeenCalled()
    expect(hoisted.runWorkflow).not.toHaveBeenCalled()
  })

  it('does not check the exclusive lock for a background workflow', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'background' }))
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockResolvedValue({ id: 'workflow_run_1', state: 'done' })

    await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(hoisted.hasActiveCustomerFacingRun).not.toHaveBeenCalled()
  })

  it('reports nothing_to_do when the conversation has vanished', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(null)

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'nothing_to_do' })
    expect(hoisted.runWorkflow).not.toHaveBeenCalled()
  })

  it('reports nothing_to_do when runWorkflow returns null (empty walk or lost race)', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockResolvedValue(null)

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'nothing_to_do' })
  })

  it('calls runWorkflow with subjectPrincipalId null (bypassing per-person frequency caps)', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockResolvedValue({ id: 'workflow_run_1', state: 'done' })

    await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(hoisted.runWorkflow).toHaveBeenCalledWith(expect.any(Object), ctx, {
      conversationId: 'conversation_1',
      subjectPrincipalId: null,
    })
  })

  it('returns ok + runId + state on success', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockResolvedValue({ id: 'workflow_run_1', state: 'waiting' })

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: true, runId: 'workflow_run_1', state: 'waiting' })
  })

  it('maps a unique-violation thrown by runWorkflow to locked (defense in depth)', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'customer_facing' }))
    hoisted.hasActiveCustomerFacingRun.mockResolvedValue(false)
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505' })
    hoisted.runWorkflow.mockRejectedValue(pgError)

    const result = await runWorkflowManuallyFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(result).toEqual({ ok: false, reason: 'locked' })
  })

  it('rethrows a non-unique-violation error', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.resolveConditionContext.mockResolvedValue(ctx)
    hoisted.runWorkflow.mockRejectedValue(new Error('boom'))

    await expect(
      runWorkflowManuallyFn({
        data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
      })
    ).rejects.toThrow('boom')
  })
})
