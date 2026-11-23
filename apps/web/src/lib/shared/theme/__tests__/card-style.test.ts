/**
 * The card style: Border (the default, and today's look), Shadow or Flat, for
 * the post cards, welcome card, composer and side panels. Written as CSS
 * variables each card reads, worked out for each side from its own colours.
 */
import { describe, expect, it } from 'vitest'
import { cardStyleCss, flatFill } from '../card-style'
import { contrastRatio } from '../colour-setters'
import { generateWorkspaceThemeCSS, themeExtrasCss } from '../generator'
import { DEFAULT_DARK_BASE, DEFAULT_LIGHT_BASE } from '../expand'

const block = (css: string, selector: ':root' | '.dark') =>
  new RegExp(`${selector === ':root' ? ':root' : '\\.dark'} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('card style', () => {
  it('writes nothing for Border, the stylesheet’s own look', () => {
    expect(cardStyleCss('border', {})).toBe('')
    expect(cardStyleCss(undefined, {})).toBe('')
    expect(generateWorkspaceThemeCSS({ cardStyle: 'border' })).not.toContain('--portal-card')
  })

  it('Shadow lifts cards off a light page with no border', () => {
    const light = block(cardStyleCss('shadow', {}), ':root')
    expect(light).toContain('--portal-card-border: transparent;')
    expect(light).toMatch(/--portal-card-shadow: 0 1px 2px [^;]+, 0 6px 20px -10px [^;]+;/)
    expect(light).toContain('--portal-card-background: initial;')
  })

  it('Shadow keeps a faint border in dark mode, where a shadow vanishes', () => {
    const dark = block(cardStyleCss('shadow', {}), '.dark')
    expect(dark).toContain('--portal-card-border: initial;')
    expect(dark).toContain('--portal-card-shadow:')
    // A light side painted dark is a dark page too.
    const painted = block(cardStyleCss('shadow', { light: { background: '#101418' } }), ':root')
    expect(painted).toContain('--portal-card-border: initial;')
  })

  it('never leaks one side’s look into the other', () => {
    for (const style of ['shadow', 'flat'] as const) {
      const css = cardStyleCss(style, {})
      for (const name of [
        '--portal-card-border',
        '--portal-card-shadow',
        '--portal-card-background',
        '--portal-card-inset',
        '--portal-card-ink-min',
        '--portal-card-ink-max',
      ])
        // Whatever :root sets, .dark sets again (a value, or `initial` for its own default).
        if (block(css, ':root').includes(`${name}:`))
          expect(block(css, '.dark')).toContain(`${name}:`)
    }
  })

  it('Flat fills cards with a shade that stands off the page, with no border or shadow', () => {
    for (const [selector, base] of [
      [':root', DEFAULT_LIGHT_BASE],
      ['.dark', DEFAULT_DARK_BASE],
    ] as const) {
      const side = block(cardStyleCss('flat', {}), selector)
      const fill = /--portal-card-background: (#[\da-f]{6});/.exec(side)?.[1]
      expect(fill).toBeDefined()
      expect(contrastRatio(fill!, base.background)).toBeGreaterThanOrEqual(1.1)
      expect(contrastRatio(base.mutedForeground, fill!)).toBeGreaterThanOrEqual(4.5)
      expect(side).toContain('--portal-card-border: transparent;')
      expect(side).toContain('--portal-card-shadow: none;')
      // What sits on the fill as a quiet fill takes the card colour, so it still shows.
      expect(side).toContain('--portal-card-inset: var(--card);')
    }
  })

  it('holds coloured text on a flat fill a step nearer the text colour, so it still reads', () => {
    const css = cardStyleCss('flat', {})
    expect(block(css, ':root')).toContain('--portal-card-ink-max: 0.44;')
    expect(block(css, ':root')).toContain('--portal-card-ink-min: initial;')
    expect(block(css, '.dark')).toContain('--portal-card-ink-min: 0.88;')
    expect(block(css, '.dark')).toContain('--portal-card-ink-max: initial;')
    // Only on a fill: Shadow leaves the page's own limits.
    expect(block(cardStyleCss('shadow', {}), ':root')).toContain('--portal-card-ink-max: initial;')
  })

  it('Flat keeps a faint border when no fill both stands off the page and stays readable', () => {
    // Quiet text that only just reads on the page reads on nothing darker.
    const palette = { background: '#ffffff', foreground: '#0a0a0a', mutedForeground: '#767676' }
    expect(flatFill(palette, 'light')).toBeNull()
    const side = block(cardStyleCss('flat', { light: palette }), ':root')
    expect(side).toContain('--portal-card-border: initial;')
    expect(side).toContain('--portal-card-shadow: none;')
    expect(side).not.toContain('--portal-card-background: #')
    expect(side).toContain('--portal-card-inset: initial;')
    // Colours it cannot read are never guessed at.
    expect(flatFill({ background: 'var(--x)' }, 'light')).toBeNull()
    expect(flatFill({ mutedForeground: 'var(--x)' }, 'light')).toBeNull()
    // A line it does not read (the header standing in for the other side's) is no obstacle.
    expect(flatFill({ header: 'var(--background)' }, 'dark')).not.toBeNull()
  })

  it('follows the theme mode: a dark-only portal has its values on :root', () => {
    const dark = cardStyleCss('shadow', {}, { themeMode: 'dark' })
    expect(dark).not.toContain('.dark')
    expect(block(dark, ':root')).toContain('--portal-card-border: initial;')
    const light = cardStyleCss('shadow', {}, { themeMode: 'light' })
    expect(light).not.toContain('.dark')
    expect(block(light, ':root')).toContain('--portal-card-border: transparent;')
  })

  it('the live theme carries it, from the theme’s own colours', () => {
    const live = generateWorkspaceThemeCSS({
      cardStyle: 'flat',
      themeMode: 'light',
      light: { background: '#f6f5f2', foreground: '#1b1b1f' },
    })
    const fill = /--portal-card-background: (#[\da-f]{6});/.exec(live)?.[1]
    expect(contrastRatio(fill!, '#f6f5f2')).toBeGreaterThanOrEqual(1.1)
  })

  it('a draft over a saved style says Border out loud', () => {
    const css = themeExtrasCss({ cardStyle: 'border' }, { explicit: true })
    expect(block(css, ':root')).toContain('--portal-card-border: initial;')
    expect(block(css, '.dark')).toContain('--portal-card-shadow: initial;')
    expect(themeExtrasCss({ cardStyle: 'border' })).toBe('')
  })
})
