import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockGetPortalConfig: vi.fn(),
  mockIsMessengerEnabled: vi.fn(),
}))

vi.mock('../settings.service', () => ({
  isFeatureEnabled: hoisted.mockIsFeatureEnabled,
  getPortalConfig: hoisted.mockGetPortalConfig,
}))

vi.mock('../settings.widget', () => ({
  isMessengerEnabled: hoisted.mockIsMessengerEnabled,
}))

import { isPortalSupportEnabled, isConversationsEnabled } from '../settings.support'
import { DEFAULT_PORTAL_CONFIG } from '../settings.types'

describe('DEFAULT_PORTAL_CONFIG.support', () => {
  it('is disabled by default so shipping the gate changes nothing for existing workspaces', () => {
    expect(DEFAULT_PORTAL_CONFIG.support?.enabled).toBe(false)
  })
})

describe('isPortalSupportEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { flag: true, support: { enabled: true }, expected: true },
    { flag: false, support: { enabled: true }, expected: false },
    { flag: true, support: { enabled: false }, expected: false },
    { flag: true, support: undefined, expected: false },
  ])('flag=$flag support=$support → $expected', async ({ flag, support, expected }) => {
    hoisted.mockIsFeatureEnabled.mockResolvedValue(flag)
    hoisted.mockGetPortalConfig.mockResolvedValue({ support })
    expect(await isPortalSupportEnabled()).toBe(expected)
  })

  it('checks the supportInbox feature flag specifically', async () => {
    hoisted.mockIsFeatureEnabled.mockResolvedValue(true)
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { enabled: true } })
    await isPortalSupportEnabled()
    expect(hoisted.mockIsFeatureEnabled).toHaveBeenCalledWith('supportInbox')
  })
})

describe('isConversationsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Converged Messages: tickets count as a conversation surface — every
  // customer ticket is a conversation pair, so an email-first workspace with
  // the messenger off still lists and replies to its threads.
  it.each([
    { widget: true, portalSupport: false, tickets: false, expected: true },
    { widget: false, portalSupport: true, tickets: false, expected: true },
    { widget: true, portalSupport: true, tickets: false, expected: true },
    { widget: false, portalSupport: false, tickets: true, expected: true },
    { widget: false, portalSupport: false, tickets: false, expected: false },
  ])(
    'widget=$widget portalSupport=$portalSupport tickets=$tickets → $expected',
    async ({ widget, portalSupport, tickets, expected }) => {
      hoisted.mockIsFeatureEnabled.mockImplementation(async (flag: string) =>
        flag === 'supportTickets' ? tickets : true
      )
      hoisted.mockIsMessengerEnabled.mockResolvedValue(widget)
      hoisted.mockGetPortalConfig.mockResolvedValue({ support: { enabled: portalSupport } })
      expect(await isConversationsEnabled()).toBe(expected)
    }
  )
})
