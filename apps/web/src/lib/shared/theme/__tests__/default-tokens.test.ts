import { describe, expect, it } from 'vitest'
import { computeAccentInk, expandTheme, DEFAULT_DARK_BASE, DEFAULT_LIGHT_BASE } from '../expand'
import { generateThemeCSS, generateWorkspaceThemeCSS } from '../generator'
import type { ThemeConfig } from '../types'

function readVar(css: string, selector: string, name: string): string | undefined {
  const block = css.split('}').find((part) => part.includes(`${selector} {`))
  if (!block) return undefined
  const match = block.match(new RegExp(`${name}:\\s*([^;]+)`))
  return match?.[1]?.trim()
}

describe('computeAccentInk', () => {
  it('steps default gold down in lightness only, keeping chroma and hue', () => {
    expect(computeAccentInk('oklch(0.886 0.176 86)', 'light')).toBe('oklch(0.720 0.176 86)')
  })

  it('leaves dark-mode gold unchanged', () => {
    expect(computeAccentInk('oklch(0.886 0.176 86)', 'dark')).toBe('oklch(0.886 0.176 86)')
  })
})

describe('default theme tokens', () => {
  it('emits the default tokens on :root for an unbranded workspace', () => {
    const css = generateThemeCSS({})
    expect(css).toContain(':root')
    expect(generateThemeCSS(null as unknown as ThemeConfig)).toBe('')
  })

  it('emits the unbranded light and dark tokens', () => {
    const css = generateThemeCSS({})
    expect(css).toContain(':root')
    expect(readVar(css, ':root', '--background')).toBe(DEFAULT_LIGHT_BASE.background)
    expect(readVar(css, ':root', '--primary')).toBe(DEFAULT_LIGHT_BASE.primary)
    expect(css).toContain('.dark')
    expect(readVar(css, '.dark', '--background')).toBe(DEFAULT_DARK_BASE.background)
  })

  it('fills unspecified branding keys from the defaults', () => {
    const css = generateThemeCSS({ light: { primary: '#ff0000' } })
    expect(readVar(css, ':root', '--primary')).toBe('#ff0000')
    expect(readVar(css, ':root', '--background')).toBe(DEFAULT_LIGHT_BASE.background)
    expect(readVar(css, '.dark', '--background')).toBe(DEFAULT_DARK_BASE.background)
  })

  it('preserves an explicit full custom config', () => {
    const css = generateThemeCSS({
      light: {
        primary: '#111111',
        background: '#fafafa',
        foreground: '#111111',
        card: '#fafafa',
        muted: '#eeeeee',
        mutedForeground: '#666666',
        border: '#dddddd',
        destructive: '#aa0000',
        success: '#00aa00',
        fontSans: 'Georgia, serif',
        radius: '1rem',
      },
    })
    expect(readVar(css, ':root', '--primary')).toBe('#111111')
    expect(readVar(css, ':root', '--background')).toBe('#fafafa')
    expect(readVar(css, ':root', '--radius')).toBe('1rem')
    expect(css).toContain('Georgia, serif')
  })

  it('preserves forced one-mode branding', () => {
    const darkOnly = generateThemeCSS({ themeMode: 'dark', dark: { primary: '#ff5722' } })
    expect(darkOnly).toContain(':root')
    expect(darkOnly).not.toContain('.dark:where')
    expect(readVar(darkOnly, ':root', '--primary')).toBe('#ff5722')

    const lightOnly = generateThemeCSS({ themeMode: 'light', light: { primary: '#00ff00' } })
    expect(lightOnly).not.toContain('.dark')
    expect(readVar(lightOnly, ':root', '--primary')).toBe('#00ff00')
  })

  it('generateWorkspaceThemeCSS always carries the default tokens', () => {
    expect(generateWorkspaceThemeCSS({})).toContain(':root')
    expect(generateWorkspaceThemeCSS(undefined)).toContain(':root')
  })

  it('leaves the body radius to the stylesheet and custom CSS when the config sets none', () => {
    for (const config of [{}, { light: { primary: '#ff0000' } }, { light: { radius: '  ' } }]) {
      const css = generateThemeCSS(config as ThemeConfig)
      expect(css).not.toMatch(/body \{[^}]*--radius/)
    }
  })

  it('emits the body radius when the config sets one', () => {
    const css = generateThemeCSS({ light: { radius: '1rem' } })
    expect(css).toMatch(/body \{[^}]*--radius: 1rem/)
  })

  it('expandTheme fills gaps from the default palette and radius', () => {
    const expanded = expandTheme({ primary: 'oklch(0.5 0.1 20)' }, { mode: 'light' })
    expect(expanded.background).toBe(DEFAULT_LIGHT_BASE.background)
    expect(expanded.radius).toBe('0.5rem')
  })
})
