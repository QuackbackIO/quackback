/**
 * Exact values under the design's choices: each one a design sets replaces
 * what the tiles chose, scales sensibly on a phone, and wins over the card
 * styles; each one it leaves out changes nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign } from '../schema'
import { tuneCss, tuneTokens } from '../tune'

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
      '[data-qb-cards][data-portal-theme] [data-qb-surface=card] { border-radius: var(--qb-radius-card); border-width: 0px; box-shadow: none; }'
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
