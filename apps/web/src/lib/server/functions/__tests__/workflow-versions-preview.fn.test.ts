/**
 * Server-fn boundary coverage for version history + rollback and the dry-run
 * preview (support platform §4.6): permission gating (routing.manage for the
 * two read-only fns, workflow.manage for restore, matching
 * updateWorkflowFn/listWorkflowsFn's existing split), the JSON-safe version
 * DTO shape, restoreWorkflowVersionFn's not-found/mismatch guards and its
 * reuse of the update path's class-restricted-node validation, and
 * previewWorkflowFn's pass-through. The domain reads themselves
 * (listWorkflowVersions/getWorkflowVersion/previewWorkflow) are covered
 * against a real DB in workflow-versions.test.ts / workflow-preview.test.ts;
 * this file pins the fn boundary with the domain mocked (mirrors
 * workflow-reporting.fn.test.ts / workflows-class-guard.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Workflow } from '@/lib/server/db'

// createServerFn → directly-callable fns, with the real zod validator
// applied so boundary rules are exercised too (mirrors the sibling fn tests).
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
  listWorkflowVersions: vi.fn(),
  getWorkflowVersion: vi.fn(),
  previewWorkflow: vi.fn(),
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
vi.mock('@/lib/server/domains/workflows/workflow-versions', () => ({
  listWorkflowVersions: hoisted.listWorkflowVersions,
  getWorkflowVersion: hoisted.getWorkflowVersion,
}))
vi.mock('@/lib/server/domains/workflows/workflow-preview', () => ({
  previewWorkflow: hoisted.previewWorkflow,
}))

import { listWorkflowVersionsFn, restoreWorkflowVersionFn, previewWorkflowFn } from '../workflows'

function makeWorkflow(extra: Partial<Workflow> = {}): Workflow {
  return {
    id: 'workflow_1',
    name: 'Route billing',
    class: 'background',
    status: 'live',
    sortOrder: 0,
    triggerType: 'conversation.created',
    triggerSettings: {},
    graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...extra,
  } as Workflow
}

function makeVersionRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'workflow_version_1',
    workflowId: 'workflow_1',
    name: 'Route billing',
    triggerType: 'conversation.created',
    triggerSettings: {},
    graph: {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [],
    },
    createdBy: 'principal_1',
    createdByName: 'Ada Lovelace',
    createdAt: new Date('2026-01-05T10:00:00Z'),
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
})

describe('permission gates', () => {
  it('listWorkflowVersionsFn gates on routing.manage, matching listWorkflowsFn', async () => {
    hoisted.listWorkflowVersions.mockResolvedValue([])
    await listWorkflowVersionsFn({ data: { workflowId: 'workflow_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({ permission: PERMISSIONS.ROUTING_MANAGE })
  })

  it('restoreWorkflowVersionFn gates on workflow.manage, matching updateWorkflowFn', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(makeVersionRow())
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow())
    hoisted.updateWorkflow.mockResolvedValue(makeWorkflow())
    await restoreWorkflowVersionFn({
      data: { workflowId: 'workflow_1', versionId: 'workflow_version_1' },
    })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.WORKFLOW_MANAGE,
    })
  })

  it('previewWorkflowFn gates on routing.manage (read-only)', async () => {
    hoisted.previewWorkflow.mockResolvedValue({
      workflowId: 'workflow_1',
      workflowStatus: 'draft',
      audienceConfigured: false,
      audienceMatched: true,
      trace: [],
      finalStatus: 'completed',
    })
    await previewWorkflowFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({ permission: PERMISSIONS.ROUTING_MANAGE })
  })

  it('every gate propagates an auth rejection without touching the domain', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listWorkflowVersionsFn({ data: { workflowId: 'workflow_1' } })).rejects.toThrow(
      'Access denied'
    )
    expect(hoisted.listWorkflowVersions).not.toHaveBeenCalled()

    await expect(
      restoreWorkflowVersionFn({ data: { workflowId: 'workflow_1', versionId: 'v1' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.getWorkflowVersion).not.toHaveBeenCalled()

    await expect(
      previewWorkflowFn({ data: { workflowId: 'workflow_1', conversationId: 'conversation_1' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.previewWorkflow).not.toHaveBeenCalled()
  })
})

describe('listWorkflowVersionsFn', () => {
  it('serializes the DTO: ISO dates, node/edge counts derived from the graph', async () => {
    hoisted.listWorkflowVersions.mockResolvedValue([makeVersionRow()])

    const result = await listWorkflowVersionsFn({ data: { workflowId: 'workflow_1' } })
    expect(hoisted.listWorkflowVersions).toHaveBeenCalledWith('workflow_1')
    expect(result).toEqual([
      {
        id: 'workflow_version_1',
        workflowId: 'workflow_1',
        name: 'Route billing',
        triggerType: 'conversation.created',
        nodeCount: 2,
        edgeCount: 0,
        createdBy: 'principal_1',
        createdByName: 'Ada Lovelace',
        createdAt: '2026-01-05T10:00:00.000Z',
      },
    ])
  })

  it('returns an empty array for a workflow with no versions', async () => {
    hoisted.listWorkflowVersions.mockResolvedValue([])
    expect(await listWorkflowVersionsFn({ data: { workflowId: 'workflow_1' } })).toEqual([])
  })
})

describe('restoreWorkflowVersionFn', () => {
  it('loads the version, applies it via updateWorkflow with the actor id, and returns the updated workflow', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(makeVersionRow())
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'background' }))
    hoisted.updateWorkflow.mockResolvedValue(makeWorkflow({ name: 'Route billing' }))

    const result = await restoreWorkflowVersionFn({
      data: { workflowId: 'workflow_1', versionId: 'workflow_version_1' },
    })

    expect(hoisted.getWorkflowVersion).toHaveBeenCalledWith('workflow_version_1')
    expect(hoisted.updateWorkflow).toHaveBeenCalledWith(
      'workflow_1',
      {
        name: 'Route billing',
        triggerType: 'conversation.created',
        triggerSettings: {},
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'close' } },
          ],
          edges: [],
        },
      },
      'principal_1'
    )
    expect(result).toMatchObject({ id: 'workflow_1' })
  })

  it('throws when the version does not exist', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(null)
    await expect(
      restoreWorkflowVersionFn({ data: { workflowId: 'workflow_1', versionId: 'nope' } })
    ).rejects.toThrow(/not found/i)
    expect(hoisted.updateWorkflow).not.toHaveBeenCalled()
  })

  it('throws when the version belongs to a different workflow', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(makeVersionRow({ workflowId: 'workflow_other' }))
    await expect(
      restoreWorkflowVersionFn({
        data: { workflowId: 'workflow_1', versionId: 'workflow_version_1' },
      })
    ).rejects.toThrow(/not found/i)
    expect(hoisted.updateWorkflow).not.toHaveBeenCalled()
  })

  it('rejects restoring a parking-block graph onto a background workflow (same guard updateWorkflowFn runs)', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(
      makeVersionRow({
        graph: {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'la', type: 'let_assistant_answer' },
          ],
          edges: [{ from: 't', to: 'la' }],
        },
      })
    )
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'background' }))

    await expect(
      restoreWorkflowVersionFn({
        data: { workflowId: 'workflow_1', versionId: 'workflow_version_1' },
      })
    ).rejects.toThrow(/let_assistant_answer/)
    expect(hoisted.updateWorkflow).not.toHaveBeenCalled()
  })

  it('does not change status — restore never includes it in the update patch', async () => {
    hoisted.getWorkflowVersion.mockResolvedValue(makeVersionRow())
    hoisted.getWorkflow.mockResolvedValue(makeWorkflow({ class: 'background', status: 'live' }))
    hoisted.updateWorkflow.mockResolvedValue(makeWorkflow({ status: 'live' }))

    await restoreWorkflowVersionFn({
      data: { workflowId: 'workflow_1', versionId: 'workflow_version_1' },
    })

    const patch = hoisted.updateWorkflow.mock.calls[0]![1]
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('class')
    expect(patch).not.toHaveProperty('sortOrder')
  })
})

describe('previewWorkflowFn', () => {
  it('passes workflowId + conversationId straight through', async () => {
    const previewResult = {
      workflowId: 'workflow_1',
      workflowStatus: 'draft' as const,
      audienceConfigured: true,
      audienceMatched: false,
      trace: [{ nodeId: 't', kind: 'trigger', summary: 'Trigger fires', outcome: 'end' as const }],
      finalStatus: 'halted' as const,
    }
    hoisted.previewWorkflow.mockResolvedValue(previewResult)

    const result = await previewWorkflowFn({
      data: { workflowId: 'workflow_1', conversationId: 'conversation_1' },
    })

    expect(hoisted.previewWorkflow).toHaveBeenCalledWith({
      workflowId: 'workflow_1',
      conversationId: 'conversation_1',
    })
    expect(result).toEqual(previewResult)
  })
})
