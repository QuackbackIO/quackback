/**
 * The headings font: an optional font for titles and headings. Unset, they
 * are set in the text font. It is its own theme variable, `--font-heading`,
 * so Advanced CSS can still override it, and a font set on one side never
 * shows on the other.
 */
import { describe, expect, it } from 'vitest'
import { expandTheme, extractMinimal } from '../expand'
import {
  generateThemeCSS,
  generateWorkspaceThemeCSS,
  headingFontStack,
  themeExtrasCss,
} from '../generator'
import { advancedCssRemainder, generateReadableCSS, parseCssToMinimal } from '../readable-css'
import { extractCssVariables } from '../css-parser'
import { resolveHeadingFontId } from '../fonts'

const MANROPE = '"Manrope", ui-sans-serif, system-ui, sans-serif'
const FILES = [{ key: 'fonts/a/display-600.woff2', weight: 600, style: 'normal' as const }]

describe('headings font', () => {
  it('writes nothing when unset, so headings follow the text font', () => {
    expect(expandTheme({}, { mode: 'light' }).fontHeading).toBeUndefined()
    expect(generateReadableCSS({}, {}, 'user')).not.toContain('--font-heading')
    expect(generateThemeCSS({})).not.toContain('--font-heading')
  })

  it('writes the font as its own variable on both sides', () => {
    const css = generateReadableCSS({ fontHeading: MANROPE }, { fontHeading: MANROPE }, 'user')
    expect(
      css.match(/--font-heading: "Manrope", ui-sans-serif, system-ui, sans-serif;/g)
    ).toHaveLength(2)
    const live = generateThemeCSS({
      light: { fontHeading: MANROPE },
      dark: { fontHeading: MANROPE },
    })
    expect(live.match(/--font-heading: "Manrope"/g)).toHaveLength(2)
  })

  it('round trips through the stylesheet', () => {
    const css = generateReadableCSS({ fontHeading: MANROPE }, { fontHeading: MANROPE }, 'user')
    const parsed = extractCssVariables(css)
    expect(parseCssToMinimal(parsed.light).fontHeading).toBe(MANROPE)
    expect(parseCssToMinimal(parsed.dark).fontHeading).toBe(MANROPE)
    expect(
      extractMinimal(expandTheme({ fontHeading: MANROPE }, { mode: 'light' })).fontHeading
    ).toBe(MANROPE)
  })

  it('is a theme line, never Advanced CSS', () => {
    const css = generateReadableCSS({ fontHeading: MANROPE }, { fontHeading: MANROPE }, 'user')
    expect(advancedCssRemainder(css)).toBe('')
    // A stale copy of the line is the theme's too: it must not read as a hand edit.
    const stale = css.replaceAll('"Manrope"', '"Lora"')
    expect(advancedCssRemainder(stale, css)).toBe('')
  })

  it('never shows one side’s font on the other', () => {
    const css = generateReadableCSS({ fontHeading: MANROPE }, {}, 'user')
    expect(css.slice(css.indexOf('.dark'))).toContain('--font-heading: initial;')
    const live = generateThemeCSS({ themeMode: 'user', dark: { fontHeading: MANROPE } })
    expect(live.slice(0, live.indexOf('.dark'))).toContain('--font-heading: initial;')
    // The stand-in is no font: read back, the side has none.
    expect(expandTheme({ fontHeading: 'initial' }, { mode: 'dark' }).fontHeading).toBeUndefined()
  })

  it('rewrites a family saved under an old name', () => {
    const live = generateThemeCSS({ light: { fontHeading: '"Geist", sans-serif' } })
    expect(live).toContain('--font-heading: "Geist Sans", sans-serif')
  })

  it('puts an uploaded heading family ahead of the text font, with its faces', () => {
    const font = { family: 'Northwind Display', files: FILES, fallback: 'inter' as const }
    expect(headingFontStack(font, MANROPE)).toBe(`"Northwind Display", ${MANROPE}`)
    const live = generateWorkspaceThemeCSS({
      customHeadingFont: font,
      light: { fontSans: MANROPE },
      dark: { fontSans: MANROPE },
    })
    expect(live).toContain(`--font-heading: "Northwind Display", ${MANROPE};`)
    expect(live).toContain('@font-face { font-family: "Northwind Display";')
    expect(live).toContain('font-weight: 600;')
    expect(live).toContain('font-display: swap;')
    expect(themeExtrasCss({ customHeadingFont: font })).toContain('fonts/a/display-600.woff2')
  })

  it('writes no faces for a heading family that is not safe to write', () => {
    const bad = { family: 'x"; } body { color: red', files: FILES, fallback: 'inter' as const }
    expect(headingFontStack(bad, MANROPE)).toBeNull()
    expect(themeExtrasCss({ customHeadingFont: bad })).toBe('')
    expect(generateWorkspaceThemeCSS({ customHeadingFont: bad })).not.toContain('--font-heading')
  })

  it('names the listed heading font a page should load', () => {
    expect(resolveHeadingFontId(null, MANROPE)).toBe('manrope')
    expect(resolveHeadingFontId(`:root { --font-heading: ${MANROPE}; }`, null)).toBe('manrope')
    expect(resolveHeadingFontId(':root { --font-heading: initial; }', MANROPE)).toBeNull()
    expect(resolveHeadingFontId(null, null)).toBeNull()
    expect(resolveHeadingFontId(null, '"Northwind Display", sans-serif')).toBeNull()
  })

  describe('a headings font for page headings only', () => {
    it('sets small titles back in the text font, and says nothing otherwise', () => {
      expect(themeExtrasCss({ headingScope: 'page' })).toContain(
        ':root { --font-title: var(--font-sans); }'
      )
      expect(themeExtrasCss({})).not.toContain('--font-title')
    })

    it('a draft with no such scope clears the saved one in the preview', () => {
      expect(themeExtrasCss({}, { explicit: true })).toContain(':root { --font-title: initial; }')
      expect(themeExtrasCss({ headingScope: 'page' }, { explicit: true })).toContain(
        '--font-title: var(--font-sans)'
      )
    })

    it('small titles read it before the headings font, in the stylesheet every portal loads', async () => {
      const { readFileSync } = await import('node:fs')
      const globals = readFileSync(new URL('../../../../globals.css', import.meta.url), 'utf8')
      expect(globals).toContain(
        '--font-heading: var(--font-title, var(--font-heading, var(--font-sans)));'
      )
    })
  })
})
