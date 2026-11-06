// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const widget = vi.hoisted(() => ({
  enabled: true,
  stored: {} as Record<string, unknown>,
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getPublicWidgetConfig: async () => ({ enabled: widget.enabled, tabs: { feedback: true } }),
  getWidgetConfig: async () => widget.stored,
}))

vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: async () => ({}),
  getCustomCss: async () => null,
}))

const mockGetTierLimits = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: mockGetTierLimits,
}))

const { getPublicServerConfig } = await import('../public-config')

function setEntitled(entitled: boolean) {
  mockGetTierLimits.mockResolvedValue({ features: { visitorAnalytics: entitled } })
}

function setStored(visitorAnalytics?: boolean, visitorDeviceTracking?: boolean) {
  widget.stored = {
    ...(visitorAnalytics === undefined ? {} : { visitorAnalytics }),
    ...(visitorDeviceTracking === undefined ? {} : { visitorDeviceTracking }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  widget.enabled = true
  widget.stored = {}
  setEntitled(true)
})

describe('getPublicServerConfig visitor tracking', () => {
  /**
   * Expected values are written out per row rather than computed, so a
   * resolver that drops the entitlement or the default cannot pass.
   */
  it.each([
    // entitled, stored page-view setting, stored device setting -> sent flags
    { entitled: true, analytics: undefined, device: undefined, sent: [true, true] },
    { entitled: true, analytics: true, device: undefined, sent: [true, true] },
    { entitled: true, analytics: true, device: true, sent: [true, true] },
    { entitled: true, analytics: true, device: false, sent: [true, false] },
    { entitled: true, analytics: undefined, device: false, sent: [true, false] },
    { entitled: true, analytics: false, device: true, sent: [false, false] },
    { entitled: true, analytics: false, device: undefined, sent: [false, false] },
    { entitled: false, analytics: undefined, device: undefined, sent: [false, false] },
    { entitled: false, analytics: true, device: true, sent: [false, false] },
    { entitled: false, analytics: true, device: false, sent: [false, false] },
    { entitled: false, analytics: false, device: false, sent: [false, false] },
  ])(
    'entitled=$entitled analytics=$analytics device=$device',
    async ({ entitled, analytics, device, sent }) => {
      setEntitled(entitled)
      setStored(analytics, device)

      const { enabled, config } = await getPublicServerConfig()

      expect(enabled).toBe(true)
      expect([config.visitorAnalytics, config.visitorDeviceTracking]).toEqual(sent)
    }
  )

  it('sends no tracking config when the widget is disabled', async () => {
    widget.enabled = false
    const { enabled, config } = await getPublicServerConfig()
    expect(enabled).toBe(false)
    expect(config).toEqual({})
  })
})
