/**
 * SLA policy server fns: permission gates, the archive guard (blocked while a
 * LIVE workflow applies the policy), the no-target-removal update rule, and
 * the workflow-graph reference scan they both ride on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { SlaPolicy, Workflow } from '@/lib/server/db'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts),
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
  createSlaPolicy: vi.fn(),
  getSlaPolicy: vi.fn(),
  listSlaPolicies: vi.fn(),
  listSlaPoliciesIncludingArchived: vi.fn(),
  restoreSlaPolicy: vi.fn(),
  softDeleteSlaPolicy: vi.fn(),
  updateSlaPolicy: vi.fn(),
  removeSlaFromConversation: vi.fn(),
  listWorkflows: vi.fn(),
  getOfficeHoursSchedule: vi.fn(),
  conversationToDTO: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/sla/sla-policy.service', () => ({
  createSlaPolicy: hoisted.createSlaPolicy,
  getSlaPolicy: hoisted.getSlaPolicy,
  listSlaPolicies: hoisted.listSlaPolicies,
  listSlaPoliciesIncludingArchived: hoisted.listSlaPoliciesIncludingArchived,
  restoreSlaPolicy: hoisted.restoreSlaPolicy,
  softDeleteSlaPolicy: hoisted.softDeleteSlaPolicy,
  updateSlaPolicy: hoisted.updateSlaPolicy,
}))
vi.mock('@/lib/server/domains/sla/sla.service', () => ({
  removeSlaFromConversation: hoisted.removeSlaFromConversation,
}))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  listWorkflows: hoisted.listWorkflows,
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: hoisted.getOfficeHoursSchedule,
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  conversationToDTO: hoisted.conversationToDTO,
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: hoisted.publishConversationUpdate,
}))

import {
  archiveSlaPolicyFn,
  createSlaPolicyFn,
  getSlaOfficeHoursFn,
  listSlaPoliciesFn,
  listSlaPolicyOptionsFn,
  removeConversationSlaFn,
  restoreSlaPolicyFn,
  updateSlaPolicyFn,
  workflowsReferencingPolicy,
} from '../sla'

function makePolicy(extra: Partial<SlaPolicy> = {}): SlaPolicy {
  return {
    id: 'sla_policy_1',
    name: 'Gold',
    firstResponseTargetSecs: 4 * 3600,
    nextResponseTargetSecs: null,
    timeToCloseTargetSecs: 3 * 86400,
    timeToResolveTargetSecs: null,
    pauseOnSnooze: true,
    pauseOnPending: true,
    officeHoursScheduleId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...extra,
  } as SlaPolicy
}

function makeWorkflow(
  extra: Partial<Workflow> & { policyId?: string; status?: string } = {}
): Workflow {
  const { policyId, ...rest } = extra
  return {
    id: 'workflow_1',
    name: 'Route VIPs',
    status: 'live',
    graph: policyId
      ? {
          nodes: [
            { id: 't', type: 'trigger' },
            { id: 'a', type: 'action', action: { type: 'apply_sla', policyId } },
          ],
          edges: [{ from: 't', to: 'a' }],
        }
      : { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    ...rest,
  } as unknown as Workflow
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.listWorkflows.mockResolvedValue([])
  hoisted.listSlaPolicies.mockResolvedValue([])
  hoisted.listSlaPoliciesIncludingArchived.mockResolvedValue([])
})

describe('workflowsReferencingPolicy', () => {
  it('matches apply_sla actions for the policy and ignores everything else', () => {
    const workflows = [
      makeWorkflow({ id: 'workflow_1', policyId: 'sla_policy_1' }),
      makeWorkflow({ id: 'workflow_2', policyId: 'sla_policy_other' }),
      makeWorkflow({ id: 'workflow_3' }),
    ] as Workflow[]
    expect(workflowsReferencingPolicy(workflows, 'sla_policy_1')).toEqual([
      { id: 'workflow_1', name: 'Route VIPs', status: 'live' },
    ])
  })

  it('never matches on a malformed graph', () => {
    const broken = [
      { id: 'w', name: 'Broken', status: 'live', graph: null },
      { id: 'w2', name: 'Odd', status: 'live', graph: { nodes: 'nope' } },
    ] as unknown as Workflow[]
    expect(workflowsReferencingPolicy(broken, 'sla_policy_1')).toEqual([])
  })
})

describe('permission gates', () => {
  it('management fns gate on sla.manage; the picker gates on conversation.view; removal on conversation.set_status', async () => {
    await listSlaPoliciesFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({ permission: PERMISSIONS.SLA_MANAGE })

    await listSlaPolicyOptionsFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.CONVERSATION_VIEW,
    })

    hoisted.createSlaPolicy.mockResolvedValue(makePolicy())
    await createSlaPolicyFn({ data: { name: 'Gold', firstResponseTargetSecs: 3600 } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({ permission: PERMISSIONS.SLA_MANAGE })

    hoisted.removeSlaFromConversation.mockResolvedValue(null)
    await removeConversationSlaFn({ data: { conversationId: 'conversation_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.CONVERSATION_SET_STATUS,
    })
  })

  it('propagates an auth rejection without touching the service', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listSlaPoliciesFn()).rejects.toThrow('Access denied')
    expect(hoisted.listSlaPoliciesIncludingArchived).not.toHaveBeenCalled()
  })
})

describe('listSlaPoliciesFn', () => {
  it('returns live + archived policies with their workflow references', async () => {
    hoisted.listSlaPoliciesIncludingArchived.mockResolvedValue([
      makePolicy(),
      makePolicy({ id: 'sla_policy_2', name: 'Old', deletedAt: new Date('2026-06-01T00:00:00Z') }),
    ])
    hoisted.listWorkflows.mockResolvedValue([makeWorkflow({ policyId: 'sla_policy_1' })])

    const result = (await listSlaPoliciesFn()) as Array<{
      id: string
      archivedAt: string | null
      usedByWorkflows: unknown[]
    }>
    expect(result).toHaveLength(2)
    expect(result[0].usedByWorkflows).toEqual([
      { id: 'workflow_1', name: 'Route VIPs', status: 'live' },
    ])
    expect(result[0].archivedAt).toBeNull()
    expect(result[1].archivedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(result[1].usedByWorkflows).toEqual([])
  })
})

describe('listSlaPolicyOptionsFn', () => {
  it('serves live-only options with a targets summary', async () => {
    hoisted.listSlaPolicies.mockResolvedValue([makePolicy()])
    const options = await listSlaPolicyOptionsFn()
    expect(options).toEqual([
      { id: 'sla_policy_1', name: 'Gold', targetsSummary: 'First response 4h · close 3d' },
    ])
  })

  it('includes the resolve target in the summary when the ticket clock is set', async () => {
    hoisted.listSlaPolicies.mockResolvedValue([makePolicy({ timeToResolveTargetSecs: 5 * 86400 })])
    const options = await listSlaPolicyOptionsFn()
    expect(options).toEqual([
      {
        id: 'sla_policy_1',
        name: 'Gold',
        targetsSummary: 'First response 4h · close 3d · resolve 5d',
      },
    ])
  })
})

describe('getSlaOfficeHoursFn', () => {
  it('reflects the workspace settings-blob schedule (the canonical hours source)', async () => {
    hoisted.getOfficeHoursSchedule.mockResolvedValue({
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    })
    expect(await getSlaOfficeHoursFn()).toEqual({ officeHoursEnabled: true })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({ permission: PERMISSIONS.SLA_MANAGE })

    hoisted.getOfficeHoursSchedule.mockResolvedValue({
      enabled: false,
      timezone: 'UTC',
      intervals: [],
    })
    expect(await getSlaOfficeHoursFn()).toEqual({ officeHoursEnabled: false })
  })
})

describe('createSlaPolicyFn', () => {
  it('rejects a policy with no targets at the boundary', async () => {
    await expect(createSlaPolicyFn({ data: { name: 'Empty' } })).rejects.toThrow()
    expect(hoisted.createSlaPolicy).not.toHaveBeenCalled()
  })

  it('passes the ticket clock (TTR + pause-on-pending) through to the service', async () => {
    hoisted.createSlaPolicy.mockResolvedValue(
      makePolicy({ timeToResolveTargetSecs: 2 * 86400, pauseOnPending: false })
    )
    await createSlaPolicyFn({
      data: {
        name: 'Gold',
        firstResponseTargetSecs: 3600,
        timeToResolveTargetSecs: 2 * 86400,
        pauseOnPending: false,
      },
    })
    expect(hoisted.createSlaPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeToResolveTargetSecs: 2 * 86400,
        pauseOnPending: false,
      })
    )
  })

  it('accepts a TTR-only policy (the ticket clock alone satisfies at-least-one-target)', async () => {
    hoisted.createSlaPolicy.mockResolvedValue(makePolicy())
    await createSlaPolicyFn({ data: { name: 'TTR only', timeToResolveTargetSecs: 86400 } })
    expect(hoisted.createSlaPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ timeToResolveTargetSecs: 86400 })
    )
  })
})

describe('updateSlaPolicyFn', () => {
  it('rejects removing a target that was set', async () => {
    hoisted.getSlaPolicy.mockResolvedValue(makePolicy())
    const result = await updateSlaPolicyFn({
      data: { id: 'sla_policy_1', firstResponseTargetSecs: null },
    })
    expect(result).toMatchObject({ ok: false, code: 'TARGET_REMOVAL' })
    expect(hoisted.updateSlaPolicy).not.toHaveBeenCalled()
  })

  it('applies the no-removal rule to the resolve target too', async () => {
    hoisted.getSlaPolicy.mockResolvedValue(makePolicy({ timeToResolveTargetSecs: 5 * 86400 }))
    const result = await updateSlaPolicyFn({
      data: { id: 'sla_policy_1', timeToResolveTargetSecs: null },
    })
    expect(result).toMatchObject({ ok: false, code: 'TARGET_REMOVAL' })
    expect(hoisted.updateSlaPolicy).not.toHaveBeenCalled()
  })

  it('passes TTR + pause-on-pending updates through', async () => {
    hoisted.getSlaPolicy.mockResolvedValue(makePolicy())
    hoisted.updateSlaPolicy.mockResolvedValue(makePolicy())
    const result = await updateSlaPolicyFn({
      data: {
        id: 'sla_policy_1',
        timeToResolveTargetSecs: 4 * 86400, // add
        pauseOnPending: false,
      },
    })
    expect(result).toEqual({ ok: true })
    expect(hoisted.updateSlaPolicy).toHaveBeenCalledWith(
      'sla_policy_1',
      expect.objectContaining({
        timeToResolveTargetSecs: 4 * 86400,
        pauseOnPending: false,
      })
    )
  })

  it('allows changing and adding targets (and clearing a never-set one)', async () => {
    hoisted.getSlaPolicy.mockResolvedValue(makePolicy())
    hoisted.updateSlaPolicy.mockResolvedValue(makePolicy())
    const result = await updateSlaPolicyFn({
      data: {
        id: 'sla_policy_1',
        firstResponseTargetSecs: 2 * 3600, // change
        nextResponseTargetSecs: 8 * 3600, // add
      },
    })
    expect(result).toEqual({ ok: true })
    expect(hoisted.updateSlaPolicy).toHaveBeenCalledWith(
      'sla_policy_1',
      expect.objectContaining({
        firstResponseTargetSecs: 2 * 3600,
        nextResponseTargetSecs: 8 * 3600,
      })
    )
  })

  it('rejects an archived (or missing) policy', async () => {
    hoisted.getSlaPolicy.mockResolvedValue(null)
    await expect(updateSlaPolicyFn({ data: { id: 'sla_policy_gone', name: 'X' } })).rejects.toThrow(
      'SLA policy not found'
    )
  })
})

describe('archiveSlaPolicyFn', () => {
  it('refuses with SLA_IN_USE while a live workflow references the policy', async () => {
    hoisted.listWorkflows.mockResolvedValue([
      makeWorkflow({ id: 'workflow_live', name: 'Live one', policyId: 'sla_policy_1' }),
      makeWorkflow({
        id: 'workflow_draft',
        name: 'Draft one',
        status: 'draft',
        policyId: 'sla_policy_1',
      }),
    ])
    const result = await archiveSlaPolicyFn({ data: { id: 'sla_policy_1' } })
    expect(result).toEqual({
      ok: false,
      code: 'SLA_IN_USE',
      workflows: [{ id: 'workflow_live', name: 'Live one' }],
    })
    expect(hoisted.softDeleteSlaPolicy).not.toHaveBeenCalled()
  })

  it('archives when only non-live workflows reference it', async () => {
    hoisted.listWorkflows.mockResolvedValue([
      makeWorkflow({ id: 'workflow_draft', status: 'draft', policyId: 'sla_policy_1' }),
      makeWorkflow({ id: 'workflow_paused', status: 'paused', policyId: 'sla_policy_1' }),
    ])
    const result = await archiveSlaPolicyFn({ data: { id: 'sla_policy_1' } })
    expect(result).toEqual({ ok: true })
    expect(hoisted.softDeleteSlaPolicy).toHaveBeenCalledWith('sla_policy_1')
  })
})

describe('restoreSlaPolicyFn', () => {
  it('restores an archived policy', async () => {
    const result = await restoreSlaPolicyFn({ data: { id: 'sla_policy_1' } })
    expect(result).toEqual({ ok: true })
    expect(hoisted.restoreSlaPolicy).toHaveBeenCalledWith('sla_policy_1')
  })
})

describe('removeConversationSlaFn', () => {
  it('removes and broadcasts the fresh agent DTO', async () => {
    const row = { id: 'conversation_1' }
    hoisted.removeSlaFromConversation.mockResolvedValue(row)
    hoisted.conversationToDTO.mockResolvedValue({ id: 'conversation_1', sla: null })

    const result = await removeConversationSlaFn({ data: { conversationId: 'conversation_1' } })
    expect(result).toEqual({ ok: true, removed: true })
    expect(hoisted.conversationToDTO).toHaveBeenCalledWith(row, 'agent')
    expect(hoisted.publishConversationUpdate).toHaveBeenCalledWith('conversation_1', {
      id: 'conversation_1',
      sla: null,
    })
  })

  it('is a quiet no-op when nothing was applied', async () => {
    hoisted.removeSlaFromConversation.mockResolvedValue(null)
    const result = await removeConversationSlaFn({ data: { conversationId: 'conversation_1' } })
    expect(result).toEqual({ ok: true, removed: false })
    expect(hoisted.publishConversationUpdate).not.toHaveBeenCalled()
  })
})
