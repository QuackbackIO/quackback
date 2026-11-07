/**
 * A headline set in a colour of its own carries it: the approved Fernway design
 * sets its headline in the forest green the site uses (#163300) and Harbor in
 * its deep green. A black, grey or white headline leaves the design's ink
 * alone.
 */
import { describe, expect, it } from 'vitest'
import { headlineInkChanges } from '../colour-changes'

const LIGHT = { scheme: 'light' as const }

describe('the headline’s own ink', () => {
  it('a coloured headline on a light site keeps its colour', () => {
    // Fernway: forest green on the lime hero, as measured on the capture.
    expect(headlineInkChanges([18, 48, 1], LIGHT)).toEqual([
      expect.objectContaining({ path: 'tune.headline.colour', value: '#123001' }),
    ])
    // A navy headline.
    expect(headlineInkChanges([11, 27, 61], LIGHT)).toEqual([
      expect.objectContaining({ path: 'tune.headline.colour', value: '#0b1b3d' }),
    ])
  })

  it('a black, grey or white headline sets nothing of its own', () => {
    const none = [expect.objectContaining({ path: 'tune.headline.colour', value: null })]
    expect(headlineInkChanges([0, 0, 0], LIGHT)).toEqual(none)
    expect(headlineInkChanges([44, 43, 43], LIGHT)).toEqual(none)
    expect(headlineInkChanges([255, 255, 255], LIGHT)).toEqual(none)
    expect(headlineInkChanges(null, LIGHT)).toEqual(none)
  })

  it('a dark site’s coloured headline is not light mode’s', () => {
    expect(headlineInkChanges([84, 63, 130], { scheme: 'dark' })).toEqual([
      expect.objectContaining({ path: 'tune.headline.colour', value: null }),
    ])
  })
})
