/**
 * Quinn performance server fn: gates on analytics.view and delegates to the
 * domain query with parsed dates. Domain math is covered directly in
 * domains/analytics/__tests__/quinn-performance.test.ts; this only exercises
 * the fn's own wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

// createServerFn → directly-callable fn, with the real zod validator applied
// (mirrors sla-policies.fn.test.ts) so the date-range boundary is exercised.
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
  getQuinnPerformance: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/analytics/quinn-performance', () => ({
  getQuinnPerformance: hoisted.getQuinnPerformance,
}))

import { getQuinnPerformanceFn } from '../assistant-analytics'

const SUMMARY = {
  involvements: 4,
  conversations: 10,
  involvementRate: 40,
  resolvedConfirmed: 1,
  resolvedAssumed: 1,
  resolutionRate: 50,
  handedOff: 1,
  escalationRate: 25,
  actionsTaken: 3,
  dailyTrend: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({})
  hoisted.getQuinnPerformance.mockResolvedValue(SUMMARY)
})

describe('getQuinnPerformanceFn', () => {
  it('gates on analytics.view', async () => {
    await getQuinnPerformanceFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ANALYTICS_VIEW })
  })

  it('parses the range into Dates and delegates to the domain query', async () => {
    await getQuinnPerformanceFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(hoisted.getQuinnPerformance).toHaveBeenCalledWith(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z')
    )
  })

  it('returns the domain summary verbatim', async () => {
    const out = await getQuinnPerformanceFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(out).toEqual(SUMMARY)
  })

  it('rejects a non-ISO-datetime range before it reaches the auth gate', async () => {
    await expect(
      getQuinnPerformanceFn({ data: { from: 'not-a-date', to: '2026-07-01T00:00:00Z' } })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('propagates a denied auth gate without calling the domain query', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      getQuinnPerformanceFn({ data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.getQuinnPerformance).not.toHaveBeenCalled()
  })
})
