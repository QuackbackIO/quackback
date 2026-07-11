/**
 * Workflow reporting server fns (support platform §4.6/§7): permission gating
 * (routing.manage, matching listWorkflowsFn) and the JSON-safe DTO shape for
 * the per-run drill-down (workflowRunsFn / workflowRunTimelineFn). The domain
 * reads themselves (listWorkflowRuns / workflowRunTimeline) are covered
 * against a real DB in workflow-reporting.test.ts; this file only pins the fn
 * boundary — gate placement + Date -> ISO serialization — with the domain
 * mocked (mirrors sla-policies.fn.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
  workflowEffectiveness: vi.fn(),
  listWorkflowRuns: vi.fn(),
  workflowRunTimeline: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/workflows/workflow-reporting', () => ({
  workflowEffectiveness: hoisted.workflowEffectiveness,
  listWorkflowRuns: hoisted.listWorkflowRuns,
  workflowRunTimeline: hoisted.workflowRunTimeline,
}))

import {
  workflowEffectivenessFn,
  workflowRunsFn,
  workflowRunTimelineFn,
} from '../workflow-reporting'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.workflowEffectiveness.mockResolvedValue([])
  hoisted.listWorkflowRuns.mockResolvedValue([])
  hoisted.workflowRunTimeline.mockResolvedValue([])
})

describe('permission gates', () => {
  it('every reporting fn gates on routing.manage, matching listWorkflowsFn', async () => {
    await workflowEffectivenessFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ROUTING_MANAGE,
    })

    await workflowRunsFn({ data: { workflowId: 'workflow_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ROUTING_MANAGE,
    })

    await workflowRunTimelineFn({ data: { runId: 'workflow_run_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ROUTING_MANAGE,
    })
  })

  it('propagates an auth rejection without touching the domain read', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(workflowRunsFn({ data: { workflowId: 'workflow_1' } })).rejects.toThrow(
      'Access denied'
    )
    expect(hoisted.listWorkflowRuns).not.toHaveBeenCalled()
  })
})

describe('workflowEffectivenessFn', () => {
  it('threads the funnel counts (sentRuns/engagedRuns) through the trailing-7d DTO', async () => {
    hoisted.workflowEffectiveness.mockResolvedValue([
      {
        workflowId: 'workflow_1',
        started: 10,
        completed: 6,
        interrupted: 1,
        waiting: 3,
        sentRuns: 4,
        engagedRuns: 2,
      },
    ])
    const result = await workflowEffectivenessFn()
    expect(result).toEqual([
      {
        workflowId: 'workflow_1',
        started: 10,
        completed: 6,
        sentRuns: 4,
        engagedRuns: 2,
      },
    ])
  })
})

describe('workflowRunsFn', () => {
  it('passes the workflowId through and serializes Dates to ISO strings, nulls preserved', async () => {
    hoisted.listWorkflowRuns.mockResolvedValue([
      {
        id: 'workflow_run_1',
        state: 'done',
        startedAt: new Date('2026-01-05T10:00:00Z'),
        endedAt: new Date('2026-01-05T10:05:00Z'),
        conversationId: 'conversation_1',
      },
      {
        id: 'workflow_run_2',
        state: 'waiting',
        startedAt: new Date('2026-01-05T11:00:00Z'),
        endedAt: null,
        conversationId: null,
      },
    ])

    const result = await workflowRunsFn({ data: { workflowId: 'workflow_1' } })
    expect(hoisted.listWorkflowRuns).toHaveBeenCalledWith('workflow_1')
    expect(result).toEqual([
      {
        id: 'workflow_run_1',
        state: 'done',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T10:05:00.000Z',
        conversationId: 'conversation_1',
      },
      {
        id: 'workflow_run_2',
        state: 'waiting',
        startedAt: '2026-01-05T11:00:00.000Z',
        endedAt: null,
        conversationId: null,
      },
    ])
  })

  it('returns an empty array for a workflow with no runs', async () => {
    expect(await workflowRunsFn({ data: { workflowId: 'workflow_1' } })).toEqual([])
  })
})

describe('workflowRunTimelineFn', () => {
  it('passes the runId through and serializes the timeline, including an action_failed:<type> kind verbatim', async () => {
    hoisted.workflowRunTimeline.mockResolvedValue([
      { kind: 'started', at: new Date('2026-01-05T10:00:00Z') },
      { kind: 'action_failed:add_note', at: new Date('2026-01-05T10:00:05Z') },
      { kind: 'completed', at: new Date('2026-01-05T10:00:10Z') },
    ])

    const result = await workflowRunTimelineFn({ data: { runId: 'workflow_run_1' } })
    expect(hoisted.workflowRunTimeline).toHaveBeenCalledWith('workflow_run_1')
    expect(result).toEqual([
      { kind: 'started', at: '2026-01-05T10:00:00.000Z' },
      { kind: 'action_failed:add_note', at: '2026-01-05T10:00:05.000Z' },
      { kind: 'completed', at: '2026-01-05T10:00:10.000Z' },
    ])
  })

  it('returns an empty array for a run with no logged events', async () => {
    expect(await workflowRunTimelineFn({ data: { runId: 'workflow_run_1' } })).toEqual([])
  })
})
