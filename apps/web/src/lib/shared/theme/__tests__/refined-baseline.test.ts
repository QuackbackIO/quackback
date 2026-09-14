import { describe, expect, it } from 'vitest'
import { computeAccentInk, expandTheme, REFINED_DARK_BASE, REFINED_LIGHT_BASE } from '../expand'
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

describe('refined theme baseline', () => {
  it('keeps unparameterized generateThemeCSS on the legacy contract', () => {
    expect(generateThemeCSS({})).toBe('')
    expect(generateThemeCSS(null as unknown as ThemeConfig)).toBe('')
    const css = generateThemeCSS({ light: { primary: 'oklch(0.5 0.1 20)' } })
    expect(css).toContain(':root')
    expect(css).not.toContain('data-visual-theme')
    expect(readVar(css, ':root', '--primary')).toBe('oklch(0.5 0.1 20)')
    expect(readVar(css, ':root', '--background')).toBe('oklch(1 0 0)')
  })

  it('emits refined unbranded tokens on the document marker', () => {
    const css = generateThemeCSS({}, { baseline: 'refined' })
    expect(css).toContain(':root:where([data-visual-theme="refined"])')
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--background')).toBe(
      REFINED_LIGHT_BASE.background
    )
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--primary')).toBe(
      REFINED_LIGHT_BASE.primary
    )
    expect(css).toContain('.dark:where([data-visual-theme="refined"])')
    expect(readVar(css, '.dark:where([data-visual-theme="refined"])', '--background')).toBe(
      REFINED_DARK_BASE.background
    )
  })

  it('fills unspecified branding keys from the refined baseline', () => {
    const css = generateThemeCSS({ light: { primary: '#ff0000' } }, { baseline: 'refined' })
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--primary')).toBe('#ff0000')
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--background')).toBe(
      REFINED_LIGHT_BASE.background
    )
    expect(readVar(css, '.dark:where([data-visual-theme="refined"])', '--background')).toBe(
      REFINED_DARK_BASE.background
    )
  })

  it('preserves an explicit full custom config', () => {
    const css = generateThemeCSS(
      {
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
      },
      { baseline: 'refined' }
    )
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--primary')).toBe('#111111')
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--background')).toBe(
      '#fafafa'
    )
    expect(readVar(css, ':root:where([data-visual-theme="refined"])', '--radius')).toBe('1rem')
    expect(css).toContain('Georgia, serif')
  })

  it('preserves forced one-mode branding', () => {
    const darkOnly = generateThemeCSS(
      { themeMode: 'dark', dark: { primary: '#ff5722' } },
      { baseline: 'refined' }
    )
    expect(darkOnly).toContain(':root:where([data-visual-theme="refined"])')
    expect(darkOnly).not.toContain('.dark:where')
    expect(readVar(darkOnly, ':root:where([data-visual-theme="refined"])', '--primary')).toBe(
      '#ff5722'
    )

    const lightOnly = generateThemeCSS(
      { themeMode: 'light', light: { primary: '#00ff00' } },
      { baseline: 'refined' }
    )
    expect(lightOnly).not.toContain('.dark')
    expect(readVar(lightOnly, ':root:where([data-visual-theme="refined"])', '--primary')).toBe(
      '#00ff00'
    )
  })

  it('generateWorkspaceThemeCSS stays empty on legacy unbranded workspaces', () => {
    expect(generateWorkspaceThemeCSS({}, 'legacy')).toBe('')
    expect(generateWorkspaceThemeCSS(undefined, 'legacy')).toBe('')
    expect(generateWorkspaceThemeCSS({}, 'refined')).toContain(
      ':root:where([data-visual-theme="refined"])'
    )
  })

  it('expandTheme default baseline stays legacy', () => {
    const expanded = expandTheme({ primary: 'oklch(0.5 0.1 20)' }, { mode: 'light' })
    expect(expanded.background).toBe('oklch(1 0 0)')
    expect(expanded.radius).toBeUndefined()
  })
})
