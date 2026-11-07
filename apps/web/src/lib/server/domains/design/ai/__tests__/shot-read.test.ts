/**
 * Screenshots read for what pixels cannot say: the brand's name, where its
 * mark sits in the header (a crop box to start the icon from), and which
 * images a cookie banner covers or a pop-up dims. What the model answers is
 * held to the images given.
 */
import { describe, expect, it } from 'vitest'
import { shotRead } from '../shot-read'

const answer = {
  name: '  Paylane ',
  iconImage: 0,
  iconX: 0.07,
  iconY: 0.02,
  iconW: 0.05,
  iconH: 0.05,
  iconWordmark: false,
  bannerText: '',
  bannerImage: -1,
  bannerX: 0,
  bannerY: 0,
  bannerW: 0,
  bannerH: 0,
  dimmedImages: [] as number[],
}

describe('a screenshots read', () => {
  it('gives the name, and the icon box on its image', () => {
    expect(shotRead(answer, 2)).toEqual({
      name: 'Paylane',
      icon: { image: 0, box: { x: 0.07, y: 0.02, w: 0.05, h: 0.05 }, wordmark: false },
      banners: [],
      dimmed: [],
    })
  })

  it('keeps boxes inside their image and drops images that were not given', () => {
    const read = shotRead(
      {
        ...answer,
        iconImage: 3,
        bannerText: 'We use cookies to improve your experience. Accept all',
        bannerImage: 1,
        bannerX: -0.1,
        bannerY: 0.8,
        bannerW: 1.4,
        bannerH: 0.4,
        dimmedImages: [1, 5, 1],
      },
      2
    )
    expect(read.icon).toBeNull()
    expect(read.banners).toEqual([{ image: 1, box: { x: 0, y: 0.8, w: 1, h: 0.2 } }])
    expect(read.dimmed).toEqual([1])
  })

  it('says when the mark is a wordmark, the name set as a logo', () => {
    expect(shotRead({ ...answer, iconWordmark: true }, 1).icon?.wordmark).toBe(true)
  })

  it('has no icon where the box is too small to be one', () => {
    expect(shotRead({ ...answer, iconW: 0.001 }, 1).icon).toBeNull()
  })

  it('warns of a banner only where the words it shows are a cookie or consent banner’s', () => {
    const at = { bannerImage: 0, bannerX: 0.72, bannerY: 0.82, bannerW: 0.26, bannerH: 0.12 }
    // A chat window in the corner is no cookie banner, however the model names it.
    const chat = shotRead(
      {
        ...answer,
        ...at,
        bannerText: '11 sales reps available. We’re here to discuss your business needs. Chat now',
      },
      1
    )
    expect(chat.banners).toEqual([])
    expect(shotRead({ ...answer, ...at, bannerText: '' }, 1).banners).toEqual([])
    for (const words of [
      'We use cookies to improve your experience and for marketing. Accept all Reject all',
      'Your privacy choices: manage consent',
      'Wir verwenden Cookies. Alle akzeptieren',
    ])
      expect(shotRead({ ...answer, ...at, bannerText: words }, 1).banners).toHaveLength(1)
  })
})
