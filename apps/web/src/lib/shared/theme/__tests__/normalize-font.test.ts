import { describe, expect, it } from 'vitest'
import { normalizeFontSans, generateThemeCSS } from '../generator'

describe('normalizeFontSans', () => {
  it('maps the legacy bare "Geist" family to the bundled "Geist Sans"', () => {
    expect(normalizeFontSans('"Geist", ui-sans-serif, system-ui, sans-serif')).toBe(
      '"Geist Sans", ui-sans-serif, system-ui, sans-serif'
    )
  })

  it('is idempotent on an already-current value', () => {
    const current = '"Geist Sans", ui-sans-serif, system-ui, sans-serif'
    expect(normalizeFontSans(current)).toBe(current)
  })

  it('leaves other families untouched', () => {
    const inter = '"Inter", ui-sans-serif, system-ui, sans-serif'
    expect(normalizeFontSans(inter)).toBe(inter)
  })
})

describe('generateThemeCSS legacy font normalization', () => {
  it('renders a saved bare "Geist" config as the bundled "Geist Sans" family', () => {
    const css = generateThemeCSS({
      themeMode: 'user',
      light: {
        fontSans: '"Geist", ui-sans-serif, system-ui, sans-serif',
        primary: 'oklch(0.205 0 0)',
        destructive: 'oklch(0.577 0.245 27)',
        background: 'oklch(1 0 0)',
        foreground: 'oklch(0.145 0 0)',
      },
    })
    expect(css).toContain('"Geist Sans"')
    expect(css).not.toContain('"Geist",')
  })
})
