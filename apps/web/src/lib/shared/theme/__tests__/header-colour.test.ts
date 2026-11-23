/**
 * The header colour: an optional colour for the portal's header bar. Unset,
 * the header is the page. Set, the bar takes it, and everything on the bar
 * (the name, the tabs, the buttons) is worked out to read on it. A colour set
 * on one side never shows on the other.
 */
import { describe, expect, it } from 'vitest'
import { expandTheme } from '../expand'
import { generateThemeCSS } from '../generator'
import { generateReadableCSS } from '../readable-css'
import { contrastRatio } from '../colour-setters'

describe('header colour', () => {
  it('leaves the header to the page when unset', () => {
    const vars = expandTheme({}, { mode: 'light' })
    expect(vars.header).toBeUndefined()
    expect(vars.headerForeground).toBeUndefined()
    expect(generateReadableCSS({}, {}, 'user')).not.toContain('--header')
  })

  it('works out readable text and tabs for the bar', () => {
    const vars = expandTheme({ header: '#005eb8' }, { mode: 'light' })
    expect(vars.header).toBe('#005eb8')
    expect(vars.headerForeground).toBe('#ffffff')
    expect(vars.navInactiveColor).toBe('#ffffff')
    expect(vars.navActiveForeground).toBe('#ffffff')
    expect(vars.navActiveBackground).toBe('color-mix(in oklab, #000000 18%, #005eb8)')
    expect(expandTheme({ header: '#9fe870' }, { mode: 'light' }).navActiveBackground).toBe(
      'color-mix(in oklab, #ffffff 18%, #9fe870)'
    )
    expect(vars.headerBorder).toBe('#005eb8')
  })

  it('keeps the page’s own text on a bar it reads on', () => {
    const vars = expandTheme({ header: '#9fe870', foreground: '#163300' }, { mode: 'light' })
    expect(vars.headerForeground).toBe('#163300')
  })

  it.each(['#005eb8', '#9fe870', '#ffe600', '#232f3e', '#808080', '#d9b52e', '#073590'])(
    'reads at 4.5:1 or more on %s',
    (header) => {
      const vars = expandTheme({ header }, { mode: 'light' })
      expect(contrastRatio(vars.headerForeground!, header)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('turns the main button over when it would vanish into the bar', () => {
    const same = expandTheme({ header: '#005eb8', primary: '#005eb8' }, { mode: 'light' })
    expect(same.headerPrimary).toBe('#ffffff')
    expect(same.headerPrimaryForeground).toBe('#005eb8')
    const shows = expandTheme({ header: '#005eb8', primary: '#ffb81c' }, { mode: 'light' })
    expect(shows.headerPrimary).toBe('#ffb81c')
  })

  it('never shows one side’s header on the other', () => {
    const css = generateReadableCSS({ header: '#005eb8' }, {}, 'user')
    const dark = css.slice(css.indexOf('.dark'))
    expect(dark).toContain('--header-background: var(--background);')
    expect(dark).toContain('--header-foreground: var(--foreground);')
    const live = generateThemeCSS({ themeMode: 'user', light: { header: '#005eb8' } })
    expect(live.slice(live.indexOf('.dark'))).toContain('--header-background: var(--background);')
  })
})
