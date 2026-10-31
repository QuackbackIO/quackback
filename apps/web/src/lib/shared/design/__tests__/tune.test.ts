/**
 * Exact values under the design's choices: each one a design sets replaces
 * what the tiles chose, scales sensibly on a phone, and wins over the card
 * styles; each one it leaves out changes nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign } from '../schema'
import { tuneColourCss, tuneCss, tuneTokens } from '../tune'

describe('exact values', () => {
  it('change nothing when a design has none', () => {
    expect(tuneTokens(undefined)).toEqual({})
    expect(tuneCss(undefined)).toBe('')
    expect(renderDesignCss(resolveDesign(defaultDesign()))).not.toContain('--qb-button-height')
  })

  it('set a headline’s exact size, scaled down on a phone, and its own weight, tracking and leading', () => {
    const tokens = tuneTokens({
      headline: { size: 48, weight: 300, tracking: -0.02, leading: 1.15 },
    })
    expect(tokens['--qb-headline-size']).toBe('clamp(28px, 3.333vw, 48px)')
    expect(tokens['--qb-headline-weight']).toBe('300')
    expect(tokens['--qb-headline-tracking']).toBe('-0.02em')
    expect(tokens['--qb-headline-leading']).toBe('1.15')
    // Its line grows with it, so a big headline's line never reads as a caption.
    expect(tokens['--qb-subtitle-size']).toBe('clamp(16px, 1.167vw, 16.8px)')
    expect(tuneTokens({ headline: { size: 104 } })['--qb-subtitle-size']).toBe(
      'clamp(16px, 1.528vw, 22px)'
    )
    // The other pages' titles sit a step below the headline.
    expect(tokens['--qb-page-title-size']).toBe('clamp(24px, 2.067vw, 29.76px)')
  })

  it('give headlines the heading weight until a tune gives them their own', () => {
    const doc = defaultDesign()
    expect(renderDesignCss(resolveDesign(doc))).toContain('--qb-headline-weight: 600')
    expect(renderDesignCss(resolveDesign(doc))).toContain(
      '[data-qb-part=headline] { font-family: var(--qb-font-display); font-weight: var(--qb-headline-weight);'
    )
    doc.tune = { headline: { weight: 300 } }
    expect(renderDesignCss(resolveDesign(doc))).toContain('--qb-headline-weight: 300')
  })

  it('size section headings, labels and buttons only when tuned', () => {
    const css = tuneCss({
      heading: { size: 32 },
      label: { weight: 500 },
      button: { height: 40, radius: 4 },
    })
    expect(css).toContain(
      '[data-portal-theme] [data-qb-part=section-heading] { font-size: var(--qb-heading-size); }'
    )
    expect(css).toContain('[data-slot=button]) { font-weight: var(--qb-label-weight); }')
    expect(css).toContain('min-height: var(--qb-button-height)')
    expect(tuneTokens({ button: { radius: 4 } })['--qb-radius-button']).toBe('4px')
  })

  it('draw cards exactly, after the card styles and at their weight, so the tune wins', () => {
    const doc = defaultDesign()
    doc.layout.cards = 'raised'
    doc.tune = { card: { radius: 6, border: 0, shadow: 'none' } }
    const css = renderDesignCss(resolveDesign(doc))
    const rule =
      '[data-qb-cards][data-portal-theme] [data-qb-surface=card] { border-radius: var(--qb-radius-card); border-width: 0px; }'
    expect(css).toContain(rule)
    expect(css.indexOf(rule)).toBeGreaterThan(
      css.indexOf('[data-qb-cards=raised][data-portal-theme]')
    )
  })

  it('refuse values outside what any page can carry', () => {
    const doc = defaultDesign()
    expect(portalDesign.safeParse({ ...doc, tune: { headline: { size: 48 } } }).success).toBe(true)
    expect(portalDesign.safeParse({ ...doc, tune: { headline: { size: 900 } } }).success).toBe(
      false
    )
    expect(portalDesign.safeParse({ ...doc, tune: { button: { height: 4 } } }).success).toBe(false)
    expect(portalDesign.safeParse({ ...doc, tune: { card: { glow: 1 } } }).success).toBe(false)
  })
})

describe('exact colours', () => {
  const page = { background: '#ffffff', band: null, mixed: false }

  it('colour headlines and section headings where they read, in light mode', () => {
    const css = tuneColourCss(
      { headline: { colour: '#163300' }, heading: { colour: '#163300' } },
      { background: '#ffffff', band: '#9fe870', mixed: false }
    )
    expect(css).toContain(
      '[data-portal-theme]:not(.dark) [data-qb-part=headline] { color: #163300; }'
    )
    expect(css).toContain('[data-qb-part=section-heading] { color: #163300; }')
  })

  it('leave out a section heading colour that would not read at body size', () => {
    // 4.2:1 is large text's, not a phone's 16px heading's.
    expect(
      tuneColourCss(
        { heading: { colour: '#b4642b' } },
        { background: '#fffaf1', band: null, mixed: false }
      )
    ).toBe('')
  })

  it('leave out a colour that would not read on the page or the band', () => {
    expect(tuneColourCss({ headline: { colour: '#f0f0f0' } }, page)).toBe('')
    expect(
      tuneColourCss(
        { headline: { colour: '#163300' } },
        { background: '#ffffff', band: '#0b1020', mixed: false }
      )
    ).toBe('')
    // No one colour reads across a blend or an image.
    expect(
      tuneColourCss(
        { headline: { colour: '#163300' } },
        { background: '#ffffff', band: null, mixed: true }
      )
    ).toBe('')
  })

  it('fill buttons exactly, with their own label where it reads and the fill’s best label where not', () => {
    expect(
      tuneColourCss(
        { button: { fill: '#163300', ink: '#9fe870', case: 'upper', weight: 600 } },
        page
      )
    ).toContain(
      'background-color: #163300; color: #9fe870; font-weight: 600; text-transform: uppercase'
    )
    expect(tuneColourCss({ button: { fill: '#163300', ink: '#1f3f10' } }, page)).toContain(
      'background-color: #163300; color: #ffffff'
    )
  })

  it('change nothing without a light page', () => {
    expect(tuneColourCss({ headline: { colour: '#163300' } }, null)).toBe('')
  })
})
