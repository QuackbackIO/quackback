import { describe, expect, it } from 'vitest'
import { expandTheme } from '@/lib/shared/theme/expand'
import { normalizeFontSans } from '@/lib/shared/theme/generator'
import { themePresets } from '@/lib/shared/theme/presets'
import type { ThemeConfig, ThemeVariables } from '@/lib/shared/theme/types'
import { convertLegacyBranding, CONVERSION_DELTA_TOKENS, leadingFamily } from '../convert'
import { normaliseColor } from '../color'
import { oklchToHex } from '@/lib/shared/theme/colors'
import { resolveDesign } from '../resolve'
import { portalDesign } from '../schema'

const MODES = ['light', 'dark', 'user'] as const

/** What today's generator renders for a mode of a config. */
function legacy(config: ThemeConfig, mode: 'light' | 'dark'): ThemeVariables {
  const vars = expandTheme(config[mode] ?? {}, { mode })
  if (vars.fontSans) vars.fontSans = normalizeFontSans(vars.fontSans)
  return vars
}

/** Two token values that render the same: equal colours, or font stacks that lead with the same family. */
function same(token: string, a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (token === 'fontSans') return leadingFamily(a) === leadingFamily(b)
  const hex = (value: string) => {
    const color = normaliseColor(value)
    return color?.startsWith('oklch') ? oklchToHex(color) : color
  }
  return hex(a) !== null && hex(a) === hex(b)
}

/** Tokens that differ between today's render and the converted design's. */
function differences(config: ThemeConfig) {
  const resolved = resolveDesign(convertLegacyBranding({ brandingConfig: config }))
  const adjusted = new Set(resolved.adjustments.map((a) => `${a.mode} ${a.token}`))
  const out: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const v2 = resolved[mode]
    if (!v2) continue
    const before = legacy(config, mode)
    for (const [token, value] of Object.entries(before)) {
      const after = v2[token as keyof ThemeVariables]
      if (same(token, value, after) || adjusted.has(`${mode} ${token}`)) continue
      if ((CONVERSION_DELTA_TOKENS as readonly string[]).includes(token)) continue
      // An unset font or radius renders the stylesheet default the design states.
      if ((token === 'fontSans' || token === 'radius') && value === undefined) continue
      out.push(`${mode} ${token}: ${value} -> ${after}`)
    }
  }
  return out
}

describe('convertLegacyBranding', () => {
  it.each(Object.keys(themePresets).flatMap((id) => MODES.map((mode) => [id, mode] as const)))(
    'converts preset %s in %s mode to a valid design',
    (id, mode) => {
      const preset = themePresets[id]
      const doc = convertLegacyBranding({
        brandingConfig: { preset: id, themeMode: mode, light: preset.light, dark: preset.dark },
      })
      expect(portalDesign.safeParse(doc).error?.issues ?? []).toEqual([])
      expect(doc.basedOn).toBe(id)
      expect(doc.mode).toBe(mode === 'user' ? 'auto' : mode)
    }
  )

  it.each(Object.keys(themePresets))(
    'renders preset %s as today, apart from the listed changes',
    (id) => {
      const preset = themePresets[id]
      expect(differences({ themeMode: 'user', light: preset.light, dark: preset.dark })).toEqual([])
    }
  )

  it('renders a config with only a brand colour as today, apart from the listed changes', () => {
    for (const primary of ['#0f766e', 'oklch(0.6 0.2 300)', 'hsl(10 90% 55%)']) {
      expect(differences({ light: { primary } }), primary).toEqual([])
    }
  })

  it('keeps the dark accent today renders when only light was branded', () => {
    const doc = convertLegacyBranding({ brandingConfig: { light: { primary: '#0f766e' } } })
    expect(doc.brand.dark?.accent).toBe(expandTheme({}, { mode: 'dark' }).primary)
  })

  it('drops colours a design cannot store and falls back to today’s base', () => {
    const doc = convertLegacyBranding({
      brandingConfig: { light: { primary: 'var(--brand)', background: 'white', card: 'teal' } },
    })
    expect(doc.brand.light.accent).toBe('oklch(0.886 0.176 86)')
    expect(doc.brand.light.background).toBe('#ffffff')
    expect(doc.brand.light.surface).toBeUndefined()
  })

  it.each([
    ['0rem', 'sharp'],
    ['0.25rem', 'subtle'],
    ['6px', 'subtle'],
    ['0.5rem', 'rounded'],
    ['0.75rem', 'rounded'],
    ['1.25rem', 'pill'],
  ])('maps a %s radius to %s corners', (radius, corners) => {
    expect(convertLegacyBranding({ brandingConfig: { light: { radius } } }).shape.corners).toBe(
      corners
    )
  })

  it('maps the font to its bundled id', () => {
    const doc = convertLegacyBranding({
      brandingConfig: { light: { fontSans: '"Lora", ui-serif, Georgia, serif' } },
    })
    expect(doc.brand.fonts.body).toEqual({ kind: 'bundled', id: 'lora' })
  })

  it('carries the logos, display mode and name', () => {
    const doc = convertLegacyBranding({
      brandingConfig: null,
      logoKey: 'logos/mark.png',
      headerLogoKey: 'logos/wordmark.png',
      faviconKey: 'logos/favicon.png',
      headerDisplayMode: 'custom_logo',
      headerDisplayName: 'Acme',
    })
    expect(doc.brand.logo).toMatchObject({
      mark: { light: { key: 'logos/mark.png' } },
      wordmark: { light: { key: 'logos/wordmark.png' } },
      display: 'wordmark',
      name: 'Acme',
    })
    expect(doc.brand.favicon).toEqual({ key: 'logos/favicon.png' })
  })

  it('carries the welcome message, shown only when it has text', () => {
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    }
    const shown = convertLegacyBranding({
      brandingConfig: null,
      portalConfig: { welcomeCard: { body } },
    })
    expect(shown.pages.feedback.welcome).toEqual({ show: true, body })
    const empty = convertLegacyBranding({
      brandingConfig: null,
      portalConfig: { welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } } },
    })
    expect(empty.pages.feedback.welcome.show).toBe(false)
  })

  it('carries the menu, keeping Feedback shown as today', () => {
    const doc = convertLegacyBranding({
      brandingConfig: null,
      portalConfig: {
        nav: {
          items: [
            { id: 'feedback', type: 'feedback', enabled: false, label: 'Ideas' },
            { id: 'status', type: 'status', enabled: false },
            {
              id: 'abc',
              type: 'link',
              label: 'Docs',
              url: 'https://docs.example.com',
              newTab: false,
            },
          ],
        },
      },
    })
    expect(doc.nav.home).toEqual({ on: false, tab: false })
    expect(doc.nav.items.slice(0, 3)).toEqual([
      { type: 'feedback', shown: true, label: 'Ideas' },
      { type: 'status', shown: false },
      { type: 'link', id: 'abc', label: 'Docs', url: 'https://docs.example.com', newTab: false },
    ])
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})
