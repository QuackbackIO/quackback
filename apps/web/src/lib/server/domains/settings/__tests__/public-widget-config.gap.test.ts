/**
 * Differential-coverage tests for getPublicWidgetConfig — the client-safe
 * projection, including the imageUploadsInWidget / ticketing default (`??`)
 * branches and the chat-tab feature gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  requireSettings: vi.fn(),
  parseJsonConfig: vi.fn(),
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({ db: {}, eq: vi.fn(), settings: { id: 'id' } }))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('../settings.helpers', () => ({
  requireSettings: (...a: unknown[]) => m.requireSettings(...a),
  wrapDbError: (_label: string, err: unknown) => {
    throw err
  },
  parseJsonConfig: (...a: unknown[]) => m.parseJsonConfig(...a),
}))
vi.mock('../settings.service', () => ({
  isFeatureEnabled: (...a: unknown[]) => m.isFeatureEnabled(...a),
}))

import { getPublicWidgetConfig } from '../settings.widget'

beforeEach(() => {
  vi.clearAllMocks()
  m.requireSettings.mockResolvedValue({ id: 'org_1', widgetConfig: '{}' })
  m.isFeatureEnabled.mockResolvedValue(true)
})

describe('getPublicWidgetConfig', () => {
  it('uses explicit config values (left side of the `??` defaults) and gates chat on the feature flag', async () => {
    m.parseJsonConfig.mockReturnValueOnce({
      enabled: true,
      imageUploadsInWidget: false,
      ticketing: { enabled: true },
      tabs: { chat: true, feedback: true },
    })
    const res = await getPublicWidgetConfig()
    expect(res.imageUploadsInWidget).toBe(false)
    expect(res.ticketing?.enabled).toBe(true)
    expect(res.tabs?.chat).toBe(true)
    expect(m.isFeatureEnabled).toHaveBeenCalledWith('supportInbox')
  })

  it('falls back to defaults (right side of `??`) for a minimal config', async () => {
    m.parseJsonConfig.mockReturnValueOnce({ enabled: false })
    const res = await getPublicWidgetConfig()
    expect(res.imageUploadsInWidget).toBe(true)
    expect(res.ticketing?.enabled).toBe(false)
    expect(res.tabs?.chat).toBe(false)
  })

  it('wraps db errors', async () => {
    m.requireSettings.mockRejectedValueOnce(new Error('db down'))
    await expect(getPublicWidgetConfig()).rejects.toThrow('db down')
  })
})
