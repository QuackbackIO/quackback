import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_MESSENGER_CONFIG,
  DEFAULT_WIDGET_HOME_CARDS,
  type WidgetConfig,
  type UpdateWidgetConfigInput,
  type PublicWidgetConfig,
} from '../settings.types'

// Partial-mock the helpers so getPublicWidgetConfig reads a fixture settings row
// while deepMerge/parseJsonConfig (used by the tests below) stay real. Both the
// fresh and the cached read paths serve the fixture.
const settingsRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.helpers')>()),
  requireSettings: async () => settingsRow.current,
  requireSettingsCached: async () => settingsRow.current,
}))

import {
  generateWidgetSecret,
  publicMessengerConfig,
  getPublicWidgetConfig,
} from '../settings.widget'
import { deepMerge } from '../settings.helpers'

function fixtureRow(widget: WidgetConfig, featureFlags?: Record<string, boolean>) {
  return {
    widgetConfig: JSON.stringify(widget),
    assistantConfig: null,
    helpCenterConfig: null,
    featureFlags: featureFlags ? JSON.stringify(featureFlags) : null,
  }
}

describe('Widget Config Types', () => {
  describe('DEFAULT_MESSENGER_CONFIG', () => {
    it('is AI-first by default: assistant deployment is on and replies are off', () => {
      expect(DEFAULT_MESSENGER_CONFIG.assistant).toEqual({
        enabled: true,
        respond: false,
      })
    })
  })

  describe('DEFAULT_WIDGET_CONFIG', () => {
    it('should have enabled set to false', () => {
      expect(DEFAULT_WIDGET_CONFIG.enabled).toBe(false)
    })

    it('keeps the messenger (Messages) tab off by default', () => {
      expect(DEFAULT_WIDGET_CONFIG.tabs?.messenger).toBe(false)
    })

    it('should not have optional fields set', () => {
      expect(DEFAULT_WIDGET_CONFIG.defaultBoard).toBeUndefined()
      expect(DEFAULT_WIDGET_CONFIG.position).toBeUndefined()
    })
  })

  describe('WidgetConfig type constraints', () => {
    it('should accept a full config', () => {
      const config: WidgetConfig = {
        enabled: true,
        defaultBoard: 'feature-requests',
        position: 'bottom-right',
      }
      expect(config.enabled).toBe(true)
      expect(config.position).toBe('bottom-right')
    })

    it('should accept minimal config', () => {
      const config: WidgetConfig = {
        enabled: false,
      }
      expect(config.enabled).toBe(false)
    })

    it('should accept bottom-left position', () => {
      const config: WidgetConfig = {
        enabled: true,
        position: 'bottom-left',
      }
      expect(config.position).toBe('bottom-left')
    })

    it('carries the proactive launcher greeting through config and updates', () => {
      const config: WidgetConfig = { enabled: true, launcherGreeting: 'Need a hand?' }
      const update: UpdateWidgetConfigInput = { launcherGreeting: 'Need a hand?' }
      expect(config.launcherGreeting).toBe('Need a hand?')
      expect(update.launcherGreeting).toBe('Need a hand?')
    })
  })

  describe('UpdateWidgetConfigInput', () => {
    it('should accept partial updates', () => {
      const update: UpdateWidgetConfigInput = {
        enabled: true,
      }
      expect(update.enabled).toBe(true)
      expect(update.defaultBoard).toBeUndefined()
    })

    it('should accept all fields', () => {
      const update: UpdateWidgetConfigInput = {
        enabled: true,
        defaultBoard: 'bugs',
        position: 'bottom-left',
      }
      expect(update.position).toBe('bottom-left')
    })
  })

  describe('PublicWidgetConfig', () => {
    it('should only include public fields', () => {
      const publicConfig: PublicWidgetConfig = {
        enabled: true,
        defaultBoard: 'bugs',
        position: 'bottom-right',
      }
      expect(publicConfig.enabled).toBe(true)
      // identifyVerification is NOT in PublicWidgetConfig (type-level check)
      expect('identifyVerification' in publicConfig).toBe(false)
    })
  })

  describe('publicMessengerConfig', () => {
    it('projects the assistant identity but strips agent-only fields', () => {
      const projected = publicMessengerConfig(
        {
          enabled: true,
          assistant: { enabled: true },
          routing: { enabled: true, strategy: 'auto_assign_active' },
        },
        {
          name: 'Quinn',
          avatarUrl: null,
        }
      )
      expect(projected.assistant).toEqual({
        enabled: true,
        name: 'Quinn',
        avatarUrl: null,
      })
      expect('routing' in projected).toBe(false)
    })
  })

  describe('home config merge semantics', () => {
    it('replaces the ordered cards array wholesale (remove/reorder must persist)', () => {
      // deepMerge is the widget-config write path; arrays must REPLACE, not
      // element-merge, or removing/reordering Home cards silently breaks.
      const existing: WidgetConfig = {
        enabled: true,
        home: {
          greeting: 'Hi {name}',
          cards: [
            { id: 'a', type: 'feedback' },
            { id: 'b', type: 'link', title: 'Docs', url: 'https://docs.example.com' },
          ],
        },
      }
      const updated = deepMerge(existing, {
        home: {
          cards: [
            { id: 'b', type: 'link' as const, title: 'Docs', url: 'https://docs.example.com' },
          ],
        },
      })
      expect(updated.home?.cards).toHaveLength(1)
      expect(updated.home?.cards?.[0]?.id).toBe('b')
      // Sibling home keys survive a cards-only update.
      expect(updated.home?.greeting).toBe('Hi {name}')
    })

    it('ships a default card per built-in surface', () => {
      expect(DEFAULT_WIDGET_HOME_CARDS.map((c) => c.type)).toEqual([
        'feedback',
        'new_conversation',
        'article_search',
        'latest_updates',
      ])
    })
  })
})

describe('getPublicWidgetConfig — tickets projection (converged Messages)', () => {
  it('projects tabs.tickets from the supportTickets flag alone — no per-tab toggle', async () => {
    settingsRow.current = fixtureRow({ enabled: true, tabs: { feedback: false } })
    const projected = await getPublicWidgetConfig()
    // supportTickets defaults on; ticket pairs surface through Messages.
    expect(projected.tabs?.tickets).toBe(true)
    // Tickets can be the sole enabled surface (email-first workspaces).
    expect(projected.enabled).toBe(true)
  })

  it('projects tabs.tickets false when the flag is off', async () => {
    settingsRow.current = fixtureRow(
      { enabled: true, tabs: { feedback: false } },
      { supportTickets: false }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.tickets).toBe(false)
    expect(projected.enabled).toBe(false)
  })
})

describe('generateWidgetSecret', () => {
  it('should start with wgt_ prefix', () => {
    const secret = generateWidgetSecret()
    expect(secret).toMatch(/^wgt_/)
  })

  it('should be 68 chars total (4 prefix + 64 hex)', () => {
    const secret = generateWidgetSecret()
    expect(secret.length).toBe(68)
  })

  it('should have valid hex characters after prefix', () => {
    const secret = generateWidgetSecret()
    const hex = secret.slice(4)
    expect(hex).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should generate unique secrets', () => {
    const secret1 = generateWidgetSecret()
    const secret2 = generateWidgetSecret()
    expect(secret1).not.toBe(secret2)
  })
})
