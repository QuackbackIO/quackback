/**
 * Guidance-rule stats server fn: permission gate + delegation. createServerFn
 * is stubbed to a directly-callable fn (mirrors assistant-guidance.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: (() => Promise<unknown>) | null = null
    const fn = async () => {
      if (!_handler) throw new Error('handler not registered')
      return _handler()
    }
    fn.handler = (h: () => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getGuidanceRuleStats: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/assistant/guidance-stats', () => ({
  getGuidanceRuleStats: hoisted.getGuidanceRuleStats,
}))

import { getGuidanceRuleStatsFn } from '../assistant-guidance-stats'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.getGuidanceRuleStats.mockResolvedValue({})
})

describe('getGuidanceRuleStatsFn', () => {
  it('gates on assistant.manage', async () => {
    await getGuidanceRuleStatsFn()
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  })

  it('propagates an auth rejection without touching the domain layer', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getGuidanceRuleStatsFn()).rejects.toThrow('Access denied')
    expect(hoisted.getGuidanceRuleStats).not.toHaveBeenCalled()
  })

  it('returns the stats map from the domain layer as-is', async () => {
    hoisted.getGuidanceRuleStats.mockResolvedValue({
      assistant_guidance_1: { used: 2, resolved: 1, resolvedPct: 50 },
    })
    const result = await getGuidanceRuleStatsFn()
    expect(result).toEqual({
      assistant_guidance_1: { used: 2, resolved: 1, resolvedPct: 50 },
    })
  })
})
