/**
 * Assistant settings server fns: permission gate + boundary validation.
 * createServerFn is stubbed to a directly-callable fn (mirrors
 * sla-policies.fn.test.ts) so the real zod validator runs on each call.
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
  getAssistantConfig: vi.fn(),
  updateAssistantToolControls: vi.fn(),
  updateAssistantSurfaces: vi.fn(),
  updateAssistantBasics: vi.fn(),
  recordAuditEvent: vi.fn(),
  actorFromAuth: vi.fn(() => ({ email: 'admin@example.com' })),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
// Keep the real schema exports (the validator boundary tests exercise them);
// only the DB-touching get/update fns are replaced.
vi.mock('@/lib/server/domains/settings/settings.assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantConfig: hoisted.getAssistantConfig,
  updateAssistantToolControls: hoisted.updateAssistantToolControls,
  updateAssistantSurfaces: hoisted.updateAssistantSurfaces,
  updateAssistantBasics: hoisted.updateAssistantBasics,
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: hoisted.actorFromAuth,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

import {
  getAssistantSettingsFn,
  updateAssistantToolControlsFn,
  updateAssistantSurfacesFn,
  updateAssistantBasicsFn,
} from '../assistant-settings'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.getAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
})

describe('permission gates', () => {
  it('all four fns gate on assistant.manage', async () => {
    await getAssistantSettingsFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.updateAssistantToolControls.mockResolvedValue({})
    await updateAssistantToolControlsFn({ data: {} })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.updateAssistantSurfaces.mockResolvedValue({})
    await updateAssistantSurfacesFn({ data: {} })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.updateAssistantBasics.mockResolvedValue({})
    await updateAssistantBasicsFn({ data: {} })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })
  })

  it('propagates an auth rejection without touching the domain layer', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getAssistantSettingsFn()).rejects.toThrow('Access denied')
    expect(hoisted.getAssistantConfig).not.toHaveBeenCalled()
  })
})

describe('getAssistantSettingsFn', () => {
  it('returns all three namespaces off a single getAssistantConfig call', async () => {
    hoisted.getAssistantConfig.mockResolvedValue({
      toolControls: { end_conversation: 'approval' },
      surfaces: { widget: { instructions: 'Be concise.' } },
      basics: { tone: 'friendly', length: 'concise' },
    })

    const result = await getAssistantSettingsFn()
    expect(result).toEqual({
      toolControls: { end_conversation: 'approval' },
      surfaces: { widget: { instructions: 'Be concise.' } },
      basics: { tone: 'friendly', length: 'concise' },
    })
    expect(hoisted.getAssistantConfig).toHaveBeenCalledTimes(1)
  })
})

describe('updateAssistantToolControlsFn', () => {
  it('rejects an invalid mode at the boundary before reaching the domain layer', async () => {
    await expect(
      updateAssistantToolControlsFn({ data: { end_conversation: 'bogus' } as never })
    ).rejects.toThrow()
    expect(hoisted.updateAssistantToolControls).not.toHaveBeenCalled()
  })

  it('passes a valid map through to the domain layer', async () => {
    hoisted.updateAssistantToolControls.mockResolvedValue({ end_conversation: 'approval' })
    const result = await updateAssistantToolControlsFn({
      data: { end_conversation: 'approval' },
    })
    expect(result).toEqual({ end_conversation: 'approval' })
    expect(hoisted.updateAssistantToolControls).toHaveBeenCalledWith({
      end_conversation: 'approval',
    })
  })
})

describe('updateAssistantSurfacesFn', () => {
  it('rejects an unknown surface key at the boundary', async () => {
    await expect(
      updateAssistantSurfacesFn({ data: { sms: { instructions: 'Be concise.' } } as never })
    ).rejects.toThrow()
    expect(hoisted.updateAssistantSurfaces).not.toHaveBeenCalled()
  })

  it('passes a valid partial map through to the domain layer', async () => {
    hoisted.updateAssistantSurfaces.mockResolvedValue({ widget: { instructions: 'Be concise.' } })
    const result = await updateAssistantSurfacesFn({
      data: { widget: { instructions: 'Be concise.' } },
    })
    expect(result).toEqual({ widget: { instructions: 'Be concise.' } })
  })
})

describe('updateAssistantBasicsFn', () => {
  it('rejects an invalid tone at the boundary before reaching the domain layer', async () => {
    await expect(
      updateAssistantBasicsFn({ data: { tone: 'sarcastic' } as never })
    ).rejects.toThrow()
    expect(hoisted.updateAssistantBasics).not.toHaveBeenCalled()
  })

  it('passes a valid preset through to the domain layer', async () => {
    hoisted.updateAssistantBasics.mockResolvedValue({ tone: 'friendly', length: 'concise' })
    const result = await updateAssistantBasicsFn({
      data: { tone: 'friendly', length: 'concise' },
    })
    expect(result).toEqual({ tone: 'friendly', length: 'concise' })
    expect(hoisted.updateAssistantBasics).toHaveBeenCalledWith({
      tone: 'friendly',
      length: 'concise',
    })
  })
})

describe('audit logging', () => {
  it('updateAssistantToolControlsFn records assistant.tool_controls.changed with the submitted map', async () => {
    hoisted.updateAssistantToolControls.mockResolvedValue({ end_conversation: 'approval' })
    await updateAssistantToolControlsFn({ data: { end_conversation: 'approval' } })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'assistant.tool_controls.changed',
        after: { end_conversation: 'approval' },
      })
    )
  })

  it('updateAssistantSurfacesFn records assistant.surfaces.changed with the submitted map', async () => {
    hoisted.updateAssistantSurfaces.mockResolvedValue({ widget: { instructions: 'Be concise.' } })
    await updateAssistantSurfacesFn({ data: { widget: { instructions: 'Be concise.' } } })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'assistant.surfaces.changed',
        after: { widget: { instructions: 'Be concise.' } },
      })
    )
  })

  it('updateAssistantBasicsFn records assistant.basics.changed with the submitted preset', async () => {
    hoisted.updateAssistantBasics.mockResolvedValue({ tone: 'friendly', length: 'concise' })
    await updateAssistantBasicsFn({ data: { tone: 'friendly', length: 'concise' } })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'assistant.basics.changed',
        after: { tone: 'friendly', length: 'concise' },
      })
    )
  })
})
