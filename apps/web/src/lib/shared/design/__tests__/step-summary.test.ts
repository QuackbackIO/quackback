/**
 * A step Ask AI took, said in one short sentence: a brand match names the
 * parts it matched, never every setting.
 */
import { describe, expect, it } from 'vitest'
import { matchSummary, partsChanged } from '../step-summary'

describe('matchSummary', () => {
  it('names the parts a brand match changed, in one sentence', () => {
    expect(
      matchSummary([
        'brand.light.accent',
        'brand.light.support',
        'brand.fonts.heading',
        'brand.logo.mark.light',
        'pages.feedback.copy.submit',
        'pages.feedback.headline.title',
      ])
    ).toBe('Matched your brand: colours, fonts, logo and words.')
  })

  it('counts a logo placed beside the changes', () => {
    expect(matchSummary(['brand.light.accent'], { logo: true })).toBe(
      'Matched your brand: colours and logo.'
    )
  })

  it('names only colours, fonts, logo and words; the rest goes without saying', () => {
    expect(matchSummary(['brand.light.accent', 'layout.hero', 'shape.corners'])).toBe(
      'Matched your brand: colours.'
    )
    expect(matchSummary(['shape.corners'])).toBe('Matched your brand.')
  })
})

describe('matchSummary when the match adds Home', () => {
  it('says it added a Home page, in the same sentence', () => {
    expect(
      matchSummary([
        'brand.light.accent',
        'pages.home.headline.title',
        'nav.home.on',
        'nav.home.tab',
      ])
    ).toBe('Matched your brand: colours and words, and added a Home page.')
    expect(matchSummary(['nav.home.on'])).toBe('Matched your brand and added a Home page.')
  })

  it('says nothing of Home when Home was already on', () => {
    expect(matchSummary(['brand.light.accent', 'pages.home.headline.title'])).toBe(
      'Matched your brand: colours and words.'
    )
  })
})

describe('matchSummary on fonts', () => {
  it('names fonts only where a face changed, not a size, weight or case', () => {
    expect(
      matchSummary([
        'brand.light.accent',
        'brand.fonts.headingWeight',
        'tune.headline.size',
        'tune.headline.weight',
        'tune.button.case',
      ])
    ).toBe('Matched your brand: colours.')
    expect(matchSummary(['brand.light.accent', 'brand.fonts.body'])).toBe(
      'Matched your brand: colours and fonts.'
    )
  })

  it('does not claim fonts drawn only in the nearest face to the brand’s', () => {
    expect(
      matchSummary(['brand.light.accent', 'brand.fonts.heading'], { fontsNearest: true })
    ).toBe('Matched your brand: colours.')
  })
})

describe('partsChanged', () => {
  it('puts the hero, page background and Home in plain parts, once each', () => {
    expect(
      partsChanged([
        'layout.hero',
        'layout.heroGlow',
        'layout.background',
        'pages.home.blocks',
        'tune.headline.size',
      ])
    ).toEqual(['colours', 'fonts', 'hero', 'layout'])
  })
})
