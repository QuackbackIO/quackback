/**
 * updateWorkflowFn's class-restricted-node guard (Phase C, slice C-6):
 * a workflow parked at a `let_assistant_answer` (or other parking-block) node
 * can only ever be resumed on a customer_facing run — see
 * classRestrictedNodeIssue. The original check only ran `if (data.graph)`, so
 * a class-only patch (flipping an existing parking-block workflow to
 * background with no graph in the same request) skipped validation entirely
 * and landed on an unreachable parked run. This file pins the class-only path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Workflow } from '@/lib/server/db'

// createServerFn → directly-callable fns (mirrors sla-policies.fn.test.ts),
// with the real zod validator applied so boundary rules are exercised too.
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
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  listWorkflows: vi.fn(),
  getWorkflow: hoisted.getWorkflow,
  createWorkflow: vi.fn(),
  updateWorkflow: hoisted.updateWorkflow,
  setWorkflowStatus: vi.fn(),
  softDeleteWorkflow: vi.fn(),
}))

import { updateWorkflowFn } from '../workflows'

function makeWorkflow(extra: Partial<Workflow> = {}): Workflow {
  return {
    id: 'workflow_1',
    name: 'Let Quinn answer',
    class: 'customer_facing',
    status: 'live',
    sortOrder: 0,
    triggerType: 'conversation.created',
    triggerSettings: {},
    graph: {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'la', type: 'let_assistant_answer' },
      ],
      edges: [{ from: 't', to: 'la' }],
    },
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...extra,
  } as Workflow
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
})

describe('updateWorkflowFn class-only patch validation (SF5)', () => {
  it('rejects a class-only flip to background on a stored parking-block workflow', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'customer_facing' }))

    await expect(
      updateWorkflowFn({ data: { id: 'workflow_1', class: 'background' } })
    ).rejects.toThrow(/let_assistant_answer/)
    expect(hoisted.updateWorkflow).not.toHaveBeenCalled()
  })

  it('allows a class-only flip to background when the stored graph has no parking-block node', async () => {
    hoisted.getWorkflow.mockResolvedValue(
      makeWorkflow({
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [{ from: 't', to: 'a' }],
        },
      })
    )
    hoisted.updateWorkflow.mockResolvedValue(makeWorkflow({ class: 'background' }))

    await expect(
      updateWorkflowFn({ data: { id: 'workflow_1', class: 'background' } })
    ).resolves.toBeDefined()
    expect(hoisted.updateWorkflow).toHaveBeenCalledWith(
      'workflow_1',
      expect.objectContaining({ class: 'background' })
    )
  })

  it('still allows a class-only flip to customer_facing regardless of the stored graph', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'background' }))
    hoisted.updateWorkflow.mockResolvedValue(makeWorkflow({ class: 'customer_facing' }))

    await expect(
      updateWorkflowFn({ data: { id: 'workflow_1', class: 'customer_facing' } })
    ).resolves.toBeDefined()
    expect(hoisted.updateWorkflow).toHaveBeenCalled()
  })

  it('a combined class+graph patch still uses the existing (pre-SF5) branch, not the new class-only one', async () => {
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'customer_facing' }))
    // Not a precisely-typed ValidatedWorkflowGraph literal on purpose — only
    // the runtime zod parse (inside the mocked createServerFn) and
    // classRestrictedNodeIssue's shape (nodes: {id,type}[]) matter here.
    const badGraph = {
      nodes: [
        { id: 't', type: 'trigger' as const },
        { id: 'la', type: 'let_assistant_answer' as const },
      ],
      edges: [{ from: 't', to: 'la' }],
    }

    await expect(
      updateWorkflowFn({ data: { id: 'workflow_1', class: 'background', graph: badGraph } })
    ).rejects.toThrow(/let_assistant_answer/)
    expect(hoisted.updateWorkflow).not.toHaveBeenCalled()
  })
})
