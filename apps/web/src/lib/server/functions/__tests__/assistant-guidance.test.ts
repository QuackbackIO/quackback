import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    let handler: ((args: { data: never }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: (schema ? schema.parse(args?.data) : args?.data) as never })
    }
    fn.validator = (nextSchema: { parse: (value: unknown) => unknown }) => {
      schema = nextSchema
      return fn
    }
    fn.handler = (nextHandler: (args: { data: never }) => Promise<unknown>) => {
      handler = nextHandler
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createGuidanceRule: vi.fn(),
  listGuidanceRules: vi.fn(),
  updateGuidanceRule: vi.fn(),
  reorderGuidanceRules: vi.fn(),
  deleteGuidanceRule: vi.fn(),
  resolveToolSpecs: vi.fn(),
  recordAuditEvent: vi.fn(),
  actorFromAuth: vi.fn(() => ({ email: 'admin@example.com' })),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/assistant/guidance.service', () => ({
  createGuidanceRule: hoisted.createGuidanceRule,
  listGuidanceRules: hoisted.listGuidanceRules,
  updateGuidanceRule: hoisted.updateGuidanceRule,
  reorderGuidanceRules: hoisted.reorderGuidanceRules,
  deleteGuidanceRule: hoisted.deleteGuidanceRule,
  GUIDANCE_CHAR_BUDGET: 4_000,
}))
vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  resolveToolSpecs: hoisted.resolveToolSpecs,
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: hoisted.actorFromAuth,
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))

import {
  createGuidanceRuleFn,
  deleteGuidanceRuleFn,
  listAssistantToolsFn,
  listGuidanceRulesFn,
  reorderGuidanceRulesFn,
  updateGuidanceRuleFn,
} from '../assistant-guidance'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.listGuidanceRules.mockResolvedValue([])
  hoisted.resolveToolSpecs.mockResolvedValue([])
})

describe('permission gates', () => {
  it('gates every guidance and catalogue function on assistant.manage', async () => {
    await listGuidanceRulesFn()
    hoisted.createGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await createGuidanceRuleFn({ data: { name: 'Refunds', instruction: 'Explain refunds.' } })
    hoisted.updateGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await updateGuidanceRuleFn({ data: { id: 'assistant_guidance_1', enabled: false } })
    await reorderGuidanceRulesFn({ data: { ids: ['assistant_guidance_1'] } })
    await deleteGuidanceRuleFn({ data: { id: 'assistant_guidance_1' } })
    await listAssistantToolsFn()

    expect(hoisted.requireAuth).toHaveBeenCalledTimes(6)
    for (const call of hoisted.requireAuth.mock.calls) {
      expect(call[0]).toEqual({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    }
  })

  it('propagates auth rejection before the domain call', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listGuidanceRulesFn()).rejects.toThrow('Access denied')
    expect(hoisted.listGuidanceRules).not.toHaveBeenCalled()
  })
})

describe('V2 guidance boundary', () => {
  it('returns all rules with the 4,000-character budget', async () => {
    hoisted.listGuidanceRules.mockResolvedValue([{ id: 'assistant_guidance_1', enabled: false }])
    await expect(listGuidanceRulesFn()).resolves.toEqual({
      rules: [{ id: 'assistant_guidance_1', enabled: false }],
      charBudget: 4_000,
    })
    expect(hoisted.listGuidanceRules).toHaveBeenCalledWith({ enabledOnly: false })
  })

  it('normalizes and passes a complete V3 create input with the caller as creator', async () => {
    hoisted.createGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await createGuidanceRuleFn({
      data: {
        name: ' Refunds\u0000 ',
        appliesWhen: ' When a customer asks for a refund ',
        instruction: ' Explain the policy. ',
        agent: 'agent',
      },
    })

    expect(hoisted.createGuidanceRule).toHaveBeenCalledWith({
      name: 'Refunds',
      appliesWhen: 'When a customer asks for a refund',
      instruction: 'Explain the policy.',
      agent: 'agent',
      enabled: true,
      priority: 0,
      createdById: 'principal_admin',
    })
  })

  it('normalizes an empty condition to null', async () => {
    hoisted.createGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await createGuidanceRuleFn({
      data: { name: 'Always', appliesWhen: ' \u0000 ', instruction: 'Always do this.' },
    })
    expect(hoisted.createGuidanceRule).toHaveBeenCalledWith(
      expect.objectContaining({ appliesWhen: null })
    )
  })

  it.each([
    { name: 'x'.repeat(81), instruction: 'Fine.' },
    { name: 'Fine', appliesWhen: 'x'.repeat(501), instruction: 'Fine.' },
    { name: 'Fine', instruction: 'x'.repeat(1_001) },
    { name: 'Fine', instruction: 'Fine.', agent: 'unknown' },
  ])('rejects invalid create input %#', async (data) => {
    await expect(createGuidanceRuleFn({ data: data as never })).rejects.toThrow()
    expect(hoisted.createGuidanceRule).not.toHaveBeenCalled()
  })

  it('passes a V3 partial update without injecting defaults', async () => {
    hoisted.updateGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1', enabled: false })
    await updateGuidanceRuleFn({ data: { id: 'assistant_guidance_1', enabled: false } })
    expect(hoisted.updateGuidanceRule).toHaveBeenCalledWith('assistant_guidance_1', {
      name: undefined,
      appliesWhen: undefined,
      instruction: undefined,
      agent: undefined,
      enabled: false,
      priority: undefined,
    })
  })

  it('validates reorder and delete inputs', async () => {
    await expect(reorderGuidanceRulesFn({ data: { ids: [] } })).rejects.toThrow()
    expect(hoisted.reorderGuidanceRules).not.toHaveBeenCalled()

    await reorderGuidanceRulesFn({
      data: { ids: ['assistant_guidance_2', 'assistant_guidance_1'] },
    })
    expect(hoisted.reorderGuidanceRules).toHaveBeenCalledWith([
      'assistant_guidance_2',
      'assistant_guidance_1',
    ])

    await deleteGuidanceRuleFn({ data: { id: 'assistant_guidance_1' } })
    expect(hoisted.deleteGuidanceRule).toHaveBeenCalledWith('assistant_guidance_1')
  })
})

describe('privacy-safe audit logging', () => {
  const persistedRule = {
    id: 'assistant_guidance_1',
    name: 'Refund policy',
    appliesWhen: 'When a customer requests a refund',
    instruction: 'Private instruction body',
    agent: 'agent',
    enabled: true,
    priority: 2,
  }

  it('records V3 create metadata without the instruction body', async () => {
    hoisted.createGuidanceRule.mockResolvedValue(persistedRule)
    await createGuidanceRuleFn({
      data: {
        name: persistedRule.name,
        appliesWhen: persistedRule.appliesWhen,
        instruction: persistedRule.instruction,
        agent: 'agent',
        priority: 2,
      },
    })

    const audit = hoisted.recordAuditEvent.mock.calls[0][0]
    expect(audit).toMatchObject({
      event: 'assistant.guidance.created',
      target: { type: 'assistant_guidance', id: persistedRule.id },
      after: {
        name: persistedRule.name,
        alwaysOn: false,
        enabled: true,
        agent: 'agent',
        priority: 2,
      },
    })
    expect(JSON.stringify(audit)).not.toContain(persistedRule.instruction)
    expect(JSON.stringify(audit)).not.toContain(persistedRule.appliesWhen)
  })

  it('records V2 update metadata without the instruction body', async () => {
    hoisted.updateGuidanceRule.mockResolvedValue({ ...persistedRule, enabled: false })
    await updateGuidanceRuleFn({
      data: { id: persistedRule.id, instruction: persistedRule.instruction, enabled: false },
    })

    const audit = hoisted.recordAuditEvent.mock.calls[0][0]
    expect(audit.after).toMatchObject({ name: persistedRule.name, enabled: false, alwaysOn: false })
    expect(JSON.stringify(audit)).not.toContain(persistedRule.instruction)
  })

  it('records reorder count and delete target only', async () => {
    await reorderGuidanceRulesFn({ data: { ids: ['assistant_guidance_2'] } })
    expect(hoisted.recordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'assistant.guidance.reordered', metadata: { count: 1 } })
    )

    await deleteGuidanceRuleFn({ data: { id: 'assistant_guidance_1' } })
    expect(hoisted.recordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'assistant.guidance.deleted',
        target: { type: 'assistant_guidance', id: 'assistant_guidance_1' },
      })
    )
  })
})

describe('listAssistantToolsFn', () => {
  it('projects read/write tools and excludes control primitives', async () => {
    hoisted.resolveToolSpecs.mockResolvedValue([
      {
        name: 'end_conversation',
        label: 'End conversation',
        description: 'Close the conversation.',
        risk: 'write',
      },
      {
        name: 'handoff_to_human',
        label: 'Hand off',
        description: 'Hand off.',
        risk: 'control',
      },
    ])
    await expect(listAssistantToolsFn()).resolves.toEqual([
      {
        name: 'end_conversation',
        label: 'End conversation',
        description: 'Close the conversation.',
        risk: 'write',
      },
    ])
  })
})
