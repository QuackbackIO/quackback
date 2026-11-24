// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const widget = vi.hoisted(() => ({
  enabled: true,
  stored: {} as Record<string, unknown>,
  customCss: null as string | null,
  branding: {} as Record<string, unknown>,
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getPublicWidgetConfig: async () => ({ enabled: widget.enabled, tabs: { feedback: true } }),
  getWidgetConfig: async () => widget.stored,
}))

vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: async () => widget.branding,
  getCustomCss: async () => widget.customCss,
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

const mockGetTierLimits = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: mockGetTierLimits,
}))

const { getPublicServerConfig } = await import('../public-config')
const { FEATURE_STATES, runsWithoutPlanGate, setFeatureState } =
  await import('@/lib/server/domains/plan-limits/__tests__/feature-states')

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
  widget.customCss = null
  widget.branding = {}
  setEntitled(true)
  setFeatureState('tierOff')
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

// Custom CSS paused after the plan limits grace no longer themes the embed.
describe('getPublicServerConfig custom CSS and the plan limits pause', () => {
  it.each(FEATURE_STATES)(
    'reads theme values from custom CSS only while not paused (%s)',
    async (state) => {
      widget.customCss = ':root { --primary: #ff0000; --radius: 4px; }'
      setFeatureState(state, 'customCss')
      const { config } = await getPublicServerConfig()
      expect(config.theme).toEqual(
        runsWithoutPlanGate(state)
          ? {
              themeMode: 'user',
              lightPrimary: '#ff0000',
              lightPrimaryForeground: '#0a0a0a',
              radius: '4px',
            }
          : { themeMode: 'user' }
      )
    }
  )
})

/** WCAG contrast of two 6-digit hexes, written out so the test does not lean on the code under test. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('getPublicServerConfig launcher colours', () => {
  it('passes a stored hex primary through as lowercase 6-digit hex, with the words the portal draws on it', async () => {
    widget.branding = {
      light: { primary: '#0E7C66', primaryForeground: '#fff' },
      // A stored words colour that does not read (black on this teal is 4.1:1) is not sent.
      dark: { primary: '#0e7c66', primaryForeground: '#000' },
    }
    const { config } = await getPublicServerConfig()
    expect(config.theme).toMatchObject({
      lightPrimary: '#0e7c66',
      lightPrimaryForeground: '#fafafa',
      darkPrimary: '#0e7c66',
      darkPrimaryForeground: '#fafafa',
    })
  })

  it('gives a yellow launcher dark words', async () => {
    widget.branding = { light: { primary: '#facc15', primaryForeground: '#ffffff' } }
    const { config } = await getPublicServerConfig()
    expect(config.theme).toMatchObject({
      lightPrimary: '#facc15',
      lightPrimaryForeground: '#0a0a0a',
    })
  })

  it('darkens a mid-tone teal until its white words read at 4.5:1', async () => {
    // White on #0d9488 is 3.7:1: white words were meant for it, but do not yet read.
    widget.branding = { light: { primary: '#0d9488' }, dark: { primary: '#0d9488' } }
    const { config } = await getPublicServerConfig()
    const theme = config.theme!
    for (const [fill, ink] of [
      [theme.lightPrimary!, theme.lightPrimaryForeground!],
      [theme.darkPrimary!, theme.darkPrimaryForeground!],
    ]) {
      expect(fill).toMatch(/^#[0-9a-f]{6}$/)
      expect(fill).not.toBe('#0d9488')
      expect(['#fafafa', '#ffffff']).toContain(ink)
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('still converts an oklch primary', async () => {
    widget.branding = { light: { primary: 'oklch(1 0 0)' } }
    const { config } = await getPublicServerConfig()
    expect(config.theme?.lightPrimary).toBe('#ffffff')
  })
})

describe('getPublicServerConfig custom CSS overrides', () => {
  it('reads hex, rgb() and hsl() overrides, and works out words for an unparseable one', async () => {
    widget.customCss =
      ':root { --primary: rgb(14 124 102); --primary-foreground: #FFF; }\n' +
      '.dark { --primary: hsl(0, 100%, 50%); --primary-foreground: nonsense; }'
    const { config } = await getPublicServerConfig()
    expect(config.theme).toMatchObject({
      // Readable words set in custom CSS are kept.
      lightPrimary: '#0e7c66',
      lightPrimaryForeground: '#ffffff',
      darkPrimary: '#ff0000',
      darkPrimaryForeground: '#0a0a0a',
    })
  })

  it('replaces custom CSS words that do not read on the fill', async () => {
    widget.branding = { light: { primary: '#0e7c66' } }
    widget.customCss = ':root { --primary-foreground: #000000; }'
    const { config } = await getPublicServerConfig()
    expect(config.theme).toMatchObject({
      lightPrimary: '#0e7c66',
      lightPrimaryForeground: '#fafafa',
    })
  })
})
