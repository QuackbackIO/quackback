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
    it('is AI-first by default: assistant identity and replies are on', () => {
      expect(DEFAULT_MESSENGER_CONFIG.assistant).toEqual({
        enabled: true,
        respond: true,
      })
    })
  })

  describe('DEFAULT_WIDGET_CONFIG', () => {
    it('should have enabled set to false', () => {
      expect(DEFAULT_WIDGET_CONFIG.enabled).toBe(false)
    })

    it('keeps the messenger (Messages) tab on by default', () => {
      expect(DEFAULT_WIDGET_CONFIG.tabs?.messenger).toBe(true)
    })

    it('keeps the changelog tab on by default', () => {
      expect(DEFAULT_WIDGET_CONFIG.tabs?.changelog).toBe(true)
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

    it('carries the launcher button label through config and updates', () => {
      const config: WidgetConfig = { enabled: true, launcherLabel: 'Chat with us' }
      const update: UpdateWidgetConfigInput = { launcherLabel: 'Chat with us' }
      expect(config.launcherLabel).toBe('Chat with us')
      expect(update.launcherLabel).toBe('Chat with us')
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

describe('getPublicWidgetConfig — launcher projection', () => {
  it('projects position and the launcher button label to the public config', async () => {
    settingsRow.current = fixtureRow({
      enabled: true,
      position: 'bottom-left',
      launcherLabel: 'Chat with us',
    })
    const projected = await getPublicWidgetConfig()
    expect(projected.position).toBe('bottom-left')
    expect(projected.launcherLabel).toBe('Chat with us')
  })
})

describe('getPublicWidgetConfig — messenger tab projection', () => {
  it('projects tabs.messenger from the flag + tab, ignoring stored messenger.enabled', async () => {
    settingsRow.current = fixtureRow(
      {
        enabled: true,
        tabs: { messenger: true, feedback: false },
        messenger: { enabled: false },
      },
      { supportInbox: true }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.messenger).toBe(true)
    expect(projected.messenger?.enabled).toBe(true)
  })

  it('keeps the Messages tab off when the tab is off, even if stored messenger.enabled is true', async () => {
    settingsRow.current = fixtureRow(
      {
        enabled: true,
        tabs: { messenger: false, feedback: false },
        messenger: { enabled: true },
      },
      { supportInbox: true }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.messenger).toBe(false)
    expect(projected.messenger?.enabled).toBe(true)
  })

  it('projects messenger.enabled false when supportInbox is off', async () => {
    settingsRow.current = fixtureRow(
      {
        enabled: true,
        tabs: { messenger: true, feedback: false },
        messenger: { enabled: true },
      },
      { supportInbox: false }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.messenger).toBe(false)
    expect(projected.messenger?.enabled).toBe(false)
  })
})

describe('getPublicWidgetConfig — help tab projection', () => {
  it('projects tabs.help from the flag + tab, ignoring stored helpCenterConfig.enabled', async () => {
    settingsRow.current = {
      ...fixtureRow({ enabled: true, tabs: { help: true, feedback: false } }, { helpCenter: true }),
      helpCenterConfig: JSON.stringify({ enabled: false }),
    }
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.help).toBe(true)
  })

  it('projects tabs.help false when the flag is off', async () => {
    settingsRow.current = fixtureRow(
      { enabled: true, tabs: { help: true, feedback: false } },
      { helpCenter: false }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.help).toBe(false)
  })
})

describe('getPublicWidgetConfig — tickets projection (converged Messages)', () => {
  it('projects tabs.tickets from the supportTickets flag alone — no stored tab', async () => {
    // The flag is set explicitly, and the stored tabs deliberately carry no
    // `tickets` key: that is the point of the assertion. DEFAULT_FEATURE_FLAGS
    // is core-only (Feedback + Changelog) since 0268, so relying on a default
    // here would assert the default rather than the projection.
    settingsRow.current = fixtureRow(
      { enabled: true, tabs: { feedback: false } },
      { supportTickets: true }
    )
    const projected = await getPublicWidgetConfig()
    // Ticket pairs surface through Messages; the flag alone decides.
    expect(projected.tabs?.tickets).toBe(true)
    // Tickets can be the sole enabled surface (email-first workspaces).
    expect(projected.enabled).toBe(true)
  })

  it('projects tabs.tickets false when the flag is off', async () => {
    settingsRow.current = fixtureRow(
      { enabled: true, tabs: { feedback: false, changelog: false, messenger: false } },
      { supportTickets: false }
    )
    const projected = await getPublicWidgetConfig()
    expect(projected.tabs?.tickets).toBe(false)
    expect(projected.enabled).toBe(false)
  })
})

describe('getPublicWidgetConfig — translations', () => {
  it('projects per-locale copy so the widget iframe sees Home and messenger strings', async () => {
    settingsRow.current = fixtureRow({
      enabled: true,
      translations: {
        de: { greeting: 'Hallo', welcomeMessage: 'Willkommen' },
      },
      launcherGreeting: 'Need a hand?',
      launcherLabel: 'Chat',
    })
    const projected = await getPublicWidgetConfig()
    expect(projected.translations).toEqual({
      de: { greeting: 'Hallo', welcomeMessage: 'Willkommen' },
    })
    expect(projected.launcherGreeting).toBe('Need a hand?')
    expect(projected.launcherLabel).toBe('Chat')
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
