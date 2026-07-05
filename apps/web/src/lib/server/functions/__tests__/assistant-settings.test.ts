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
  getAssistantToolControls: vi.fn(),
  updateAssistantToolControls: vi.fn(),
  getAssistantSurfaces: vi.fn(),
  updateAssistantSurfaces: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
// Keep the real schema exports (the validator boundary tests exercise them);
// only the DB-touching get/update fns are replaced.
vi.mock('@/lib/server/domains/settings/settings.assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantToolControls: hoisted.getAssistantToolControls,
  updateAssistantToolControls: hoisted.updateAssistantToolControls,
  getAssistantSurfaces: hoisted.getAssistantSurfaces,
  updateAssistantSurfaces: hoisted.updateAssistantSurfaces,
}))

import {
  getAssistantSettingsFn,
  updateAssistantToolControlsFn,
  updateAssistantSurfacesFn,
} from '../assistant-settings'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.getAssistantToolControls.mockResolvedValue({})
  hoisted.getAssistantSurfaces.mockResolvedValue({})
})

describe('permission gates', () => {
  it('all three fns gate on assistant.manage', async () => {
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
  })

  it('propagates an auth rejection without touching the domain layer', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getAssistantSettingsFn()).rejects.toThrow('Access denied')
    expect(hoisted.getAssistantToolControls).not.toHaveBeenCalled()
  })
})

describe('getAssistantSettingsFn', () => {
  it('returns both namespaces in one call', async () => {
    hoisted.getAssistantToolControls.mockResolvedValue({ end_conversation: 'approval' })
    hoisted.getAssistantSurfaces.mockResolvedValue({ widget: { instructions: 'Be concise.' } })

    const result = await getAssistantSettingsFn()
    expect(result).toEqual({
      toolControls: { end_conversation: 'approval' },
      surfaces: { widget: { instructions: 'Be concise.' } },
    })
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
