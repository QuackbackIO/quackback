// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetTierLimits = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: mockGetTierLimits,
}))

const { isVisitorAnalyticsEntitled, resolveVisitorTracking } = await import('../visitor-tracking')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isVisitorAnalyticsEntitled', () => {
  it('reads the visitorAnalytics plan feature', async () => {
    mockGetTierLimits.mockResolvedValue({ features: { visitorAnalytics: true } })
    await expect(isVisitorAnalyticsEntitled()).resolves.toBe(true)

    mockGetTierLimits.mockResolvedValue({ features: { visitorAnalytics: false } })
    await expect(isVisitorAnalyticsEntitled()).resolves.toBe(false)
  })

  it('fails closed when the tier limits cannot be read', async () => {
    mockGetTierLimits.mockRejectedValue(new Error('settings read failed'))
    await expect(isVisitorAnalyticsEntitled()).resolves.toBe(false)
  })
})

/**
 * Each row is hand-written from the rule it documents, so the table cannot
 * agree with a resolver that got the rule wrong. An absent setting is on.
 */
describe('resolveVisitorTracking', () => {
  it.each([
    // entitled, page-view setting, device setting -> analytics, device tracking
    { entitled: true, analytics: undefined, deviceId: undefined, expected: [true, true] },
    { entitled: true, analytics: true, deviceId: undefined, expected: [true, true] },
    { entitled: true, analytics: true, deviceId: true, expected: [true, true] },
    { entitled: true, analytics: true, deviceId: false, expected: [true, false] },
    { entitled: true, analytics: undefined, deviceId: false, expected: [true, false] },
    { entitled: true, analytics: false, deviceId: true, expected: [false, false] },
    { entitled: true, analytics: false, deviceId: undefined, expected: [false, false] },
    { entitled: false, analytics: undefined, deviceId: undefined, expected: [false, false] },
    { entitled: false, analytics: true, deviceId: true, expected: [false, false] },
    { entitled: false, analytics: true, deviceId: false, expected: [false, false] },
  ])(
    'entitled=$entitled analytics=$analytics deviceId=$deviceId',
    ({ entitled, analytics, deviceId, expected }) => {
      const resolved = resolveVisitorTracking({ entitled, analytics, deviceId })
      expect([resolved.analytics, resolved.deviceTracking]).toEqual(expected)
    }
  )
})
