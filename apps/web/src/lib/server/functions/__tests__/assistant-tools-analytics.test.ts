/**
 * Tools & connectors metrics server fns: gate on analytics.view and delegate
 * to the domain queries with parsed dates. Domain math is covered directly in
 * domains/analytics/__tests__/quinn-tools.test.ts; this only exercises the
 * fns' own wiring (mirrors assistant-analytics.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

// createServerFn → directly-callable fn, with the real zod validator applied
// (mirrors assistant-analytics.test.ts) so the date-range boundary is exercised.
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
  getQuinnToolMetrics: vi.fn(),
  getConnectorHealth: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/analytics/quinn-tools', () => ({
  getQuinnToolMetrics: hoisted.getQuinnToolMetrics,
  getConnectorHealth: hoisted.getConnectorHealth,
}))

import { getQuinnToolMetricsFn, getConnectorHealthFn } from '../assistant-tools-analytics'

const TOOL_METRICS = [
  {
    toolName: 'search_kb',
    succeeded: 8,
    failed: 1,
    denied: 0,
    skippedDuplicate: 1,
    successRate: 89,
    avgLatencyMs: 420,
  },
]

const CONNECTOR_HEALTH = [
  {
    id: 'data_connector_123',
    name: 'Billing lookup',
    enabled: true,
    status: 'active' as const,
    failureCount: 0,
    lastError: null,
    healthStatus: 'healthy' as const,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({})
  hoisted.getQuinnToolMetrics.mockResolvedValue(TOOL_METRICS)
  hoisted.getConnectorHealth.mockResolvedValue(CONNECTOR_HEALTH)
})

describe('getQuinnToolMetricsFn', () => {
  it('gates on analytics.view', async () => {
    await getQuinnToolMetricsFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ANALYTICS_VIEW })
  })

  it('parses the range into Dates and delegates to the domain query', async () => {
    await getQuinnToolMetricsFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(hoisted.getQuinnToolMetrics).toHaveBeenCalledWith(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z')
    )
  })

  it('returns the domain result verbatim', async () => {
    const out = await getQuinnToolMetricsFn({
      data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
    })
    expect(out).toEqual(TOOL_METRICS)
  })

  it('rejects a non-ISO-datetime range before it reaches the auth gate', async () => {
    await expect(
      getQuinnToolMetricsFn({ data: { from: 'not-a-date', to: '2026-07-01T00:00:00Z' } })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('propagates a denied auth gate without calling the domain query', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      getQuinnToolMetricsFn({ data: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.getQuinnToolMetrics).not.toHaveBeenCalled()
  })
})

describe('getConnectorHealthFn', () => {
  it('gates on analytics.view', async () => {
    await getConnectorHealthFn()
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ANALYTICS_VIEW })
  })

  it('returns the domain result verbatim', async () => {
    const out = await getConnectorHealthFn()
    expect(out).toEqual(CONNECTOR_HEALTH)
  })

  it('propagates a denied auth gate without calling the domain query', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getConnectorHealthFn()).rejects.toThrow('Access denied')
    expect(hoisted.getConnectorHealth).not.toHaveBeenCalled()
  })
})
