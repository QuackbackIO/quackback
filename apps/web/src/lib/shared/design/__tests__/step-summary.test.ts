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
    expect(matchSummary(['brand.light.accent', 'layout.band', 'shape.corners'])).toBe(
      'Matched your brand: colours.'
    )
    expect(matchSummary(['shape.corners'])).toBe('Matched your brand.')
  })
})

describe('partsChanged', () => {
  it('puts the hero, page background and Home in plain parts, once each', () => {
    expect(
      partsChanged([
        'layout.band',
        'layout.bandGlow',
        'layout.background',
        'pages.home.blocks',
        'tune.headline.size',
      ])
    ).toEqual(['colours', 'fonts', 'hero', 'layout'])
  })
})
