/**
 * Differential-coverage tests for the widget ticketing gate — the enabled
 * pass-through (null) vs the disabled 404 envelope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ getWidgetConfig: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: (...a: unknown[]) => m.getWidgetConfig(...a),
}))
vi.mock('../cors', () => ({
  widgetJsonError: (code: string, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status }),
}))

import { widgetTicketingGate } from '../ticketing-gate'

beforeEach(() => vi.clearAllMocks())

describe('widgetTicketingGate', () => {
  it('returns null when ticketing is enabled', async () => {
    m.getWidgetConfig.mockResolvedValueOnce({ ticketing: { enabled: true } })
    expect(await widgetTicketingGate()).toBeNull()
  })
  it('returns a 404 envelope when ticketing is disabled or absent', async () => {
    m.getWidgetConfig.mockResolvedValueOnce({ ticketing: { enabled: false } })
    const res = await widgetTicketingGate()
    expect(res?.status).toBe(404)
    m.getWidgetConfig.mockResolvedValueOnce({})
    expect((await widgetTicketingGate())?.status).toBe(404)
  })
})
