/**
 * Assistant guidance-rule + tool-catalogue server fns: permission gate +
 * boundary validation. createServerFn is stubbed to a directly-callable fn
 * (mirrors assistant-settings.test.ts) so the real zod validator runs on
 * each call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
  createGuidanceRule: vi.fn(),
  listGuidanceRules: vi.fn(),
  updateGuidanceRule: vi.fn(),
  reorderGuidanceRules: vi.fn(),
  deleteGuidanceRule: vi.fn(),
  resolveToolSpecs: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/assistant/guidance.service', () => ({
  createGuidanceRule: hoisted.createGuidanceRule,
  listGuidanceRules: hoisted.listGuidanceRules,
  updateGuidanceRule: hoisted.updateGuidanceRule,
  reorderGuidanceRules: hoisted.reorderGuidanceRules,
  deleteGuidanceRule: hoisted.deleteGuidanceRule,
  GUIDANCE_CHAR_BUDGET: 4000,
}))
vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  resolveToolSpecs: hoisted.resolveToolSpecs,
}))

import {
  listGuidanceRulesFn,
  createGuidanceRuleFn,
  updateGuidanceRuleFn,
  reorderGuidanceRulesFn,
  deleteGuidanceRuleFn,
  listAssistantToolsFn,
} from '../assistant-guidance'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.listGuidanceRules.mockResolvedValue([])
  hoisted.resolveToolSpecs.mockResolvedValue([])
})

describe('permission gates', () => {
  it('every fn gates on assistant.manage', async () => {
    await listGuidanceRulesFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.createGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await createGuidanceRuleFn({ data: { title: 'Refund policy', body: 'Always mention it.' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.updateGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    await updateGuidanceRuleFn({ data: { id: 'assistant_guidance_1', enabled: false } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.reorderGuidanceRules.mockResolvedValue(undefined)
    await reorderGuidanceRulesFn({ data: { ids: ['assistant_guidance_1'] } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.deleteGuidanceRule.mockResolvedValue(undefined)
    await deleteGuidanceRuleFn({ data: { id: 'assistant_guidance_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    await listAssistantToolsFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })
  })

  it('propagates an auth rejection without touching the domain layer', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listGuidanceRulesFn()).rejects.toThrow('Access denied')
    expect(hoisted.listGuidanceRules).not.toHaveBeenCalled()
  })
})

describe('listGuidanceRulesFn', () => {
  it('returns every rule (enabled or not) plus the char budget', async () => {
    hoisted.listGuidanceRules.mockResolvedValue([{ id: 'assistant_guidance_1', enabled: false }])
    const result = await listGuidanceRulesFn()
    expect(hoisted.listGuidanceRules).toHaveBeenCalledWith({ enabledOnly: false })
    expect(result).toEqual({
      rules: [{ id: 'assistant_guidance_1', enabled: false }],
      charBudget: 4000,
    })
  })
})

describe('createGuidanceRuleFn', () => {
  it('rejects a title over 80 characters at the boundary', async () => {
    await expect(
      createGuidanceRuleFn({ data: { title: 'x'.repeat(81), body: 'Body.' } })
    ).rejects.toThrow()
    expect(hoisted.createGuidanceRule).not.toHaveBeenCalled()
  })

  it('rejects a body over 1000 characters at the boundary', async () => {
    await expect(
      createGuidanceRuleFn({ data: { title: 'Title', body: 'x'.repeat(1001) } })
    ).rejects.toThrow()
    expect(hoisted.createGuidanceRule).not.toHaveBeenCalled()
  })

  it('rejects an unknown surface at the boundary', async () => {
    await expect(
      createGuidanceRuleFn({
        data: { title: 'Title', body: 'Body.', surfaces: ['sms'] } as never,
      })
    ).rejects.toThrow()
    expect(hoisted.createGuidanceRule).not.toHaveBeenCalled()
  })

  it('passes a valid rule through with the caller as creator', async () => {
    hoisted.createGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1' })
    const result = await createGuidanceRuleFn({
      data: { title: 'Refund policy', body: 'Always mention it.', surfaces: ['widget'] },
    })
    expect(result).toEqual({ id: 'assistant_guidance_1' })
    expect(hoisted.createGuidanceRule).toHaveBeenCalledWith({
      title: 'Refund policy',
      body: 'Always mention it.',
      enabled: undefined,
      surfaces: ['widget'],
      createdById: 'principal_admin',
    })
  })
})

describe('updateGuidanceRuleFn', () => {
  it('rejects an unknown surface at the boundary', async () => {
    await expect(
      updateGuidanceRuleFn({ data: { id: 'assistant_guidance_1', surfaces: ['sms'] } as never })
    ).rejects.toThrow()
    expect(hoisted.updateGuidanceRule).not.toHaveBeenCalled()
  })

  it('passes a partial patch through to the domain layer', async () => {
    hoisted.updateGuidanceRule.mockResolvedValue({ id: 'assistant_guidance_1', enabled: false })
    const result = await updateGuidanceRuleFn({
      data: { id: 'assistant_guidance_1', enabled: false },
    })
    expect(result).toEqual({ id: 'assistant_guidance_1', enabled: false })
    expect(hoisted.updateGuidanceRule).toHaveBeenCalledWith('assistant_guidance_1', {
      title: undefined,
      body: undefined,
      enabled: false,
      surfaces: undefined,
    })
  })
})

describe('reorderGuidanceRulesFn', () => {
  it('rejects an empty id list at the boundary', async () => {
    await expect(reorderGuidanceRulesFn({ data: { ids: [] } })).rejects.toThrow()
    expect(hoisted.reorderGuidanceRules).not.toHaveBeenCalled()
  })

  it('passes the ordered id list through', async () => {
    hoisted.reorderGuidanceRules.mockResolvedValue(undefined)
    const result = await reorderGuidanceRulesFn({
      data: { ids: ['assistant_guidance_2', 'assistant_guidance_1'] },
    })
    expect(result).toEqual({ ids: ['assistant_guidance_2', 'assistant_guidance_1'] })
    expect(hoisted.reorderGuidanceRules).toHaveBeenCalledWith([
      'assistant_guidance_2',
      'assistant_guidance_1',
    ])
  })
})

describe('deleteGuidanceRuleFn', () => {
  it('deletes by id', async () => {
    hoisted.deleteGuidanceRule.mockResolvedValue(undefined)
    const result = await deleteGuidanceRuleFn({ data: { id: 'assistant_guidance_1' } })
    expect(result).toEqual({ id: 'assistant_guidance_1' })
    expect(hoisted.deleteGuidanceRule).toHaveBeenCalledWith('assistant_guidance_1')
  })
})

describe('listAssistantToolsFn', () => {
  it('projects the resolved tool catalogue to the admin-facing shape', async () => {
    hoisted.resolveToolSpecs.mockResolvedValue([
      {
        name: 'end_conversation',
        label: 'End conversation',
        description: 'Close the conversation.',
        risk: 'write',
        supportedModes: ['disabled', 'approval', 'autonomous'],
        defaultMode: 'approval',
        // Fields a model-facing spec carries that the settings UI never sees.
        permissions: [],
        definition: {},
        execute: vi.fn(),
        summarize: vi.fn(),
      },
    ])
    const result = await listAssistantToolsFn()
    expect(result).toEqual([
      {
        name: 'end_conversation',
        label: 'End conversation',
        description: 'Close the conversation.',
        risk: 'write',
        supportedModes: ['disabled', 'approval', 'autonomous'],
        defaultMode: 'approval',
      },
    ])
  })
})
