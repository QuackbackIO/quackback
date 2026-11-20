/**
 * Whether a logo shows on a surface, from the inks it was drawn in (the
 * browser reader counts its pixels): enough of it must stand off the
 * surface. A white wordmark beside a coloured mark does not show on white,
 * though one of its colours does.
 */
import { describe, expect, it } from 'vitest'
import { inkExtent, inkShown, logoShowsOn } from '../logo-ink'

const wordmark = [
  { color: '#ffffff', share: 0.62 },
  { color: '#306998', share: 0.2 },
  { color: '#ffd43b', share: 0.18 },
]

describe('logoShowsOn', () => {
  it('counts the share of the logo drawn in inks that stand off the surface', () => {
    // The yellow is too pale to stand off white as well.
    expect(inkShown(wordmark, '#ffffff')).toBeCloseTo(0.2)
    expect(inkShown(wordmark, '#2b5b84')).toBeCloseTo(0.8)
    expect(inkShown(wordmark, '#0a0a0a')).toBeCloseTo(1)
  })

  it('a logo whose main ink vanishes does not show, though a smaller one does', () => {
    expect(logoShowsOn(wordmark, '#ffffff')).toBe(false)
    expect(logoShowsOn(wordmark, '#2b5b84')).toBe(true)
  })

  it('a white bitmap does not show on white, and shows on a dark bar', () => {
    const white = [{ color: '#fefefe', share: 1 }]
    expect(logoShowsOn(white, '#ffffff')).toBe(false)
    expect(logoShowsOn(white, '#0b5cff')).toBe(true)
  })

  it('a logo with a small pale highlight still shows', () => {
    expect(
      logoShowsOn(
        [
          { color: '#5865f2', share: 0.85 },
          { color: '#ffffff', share: 0.15 },
        ],
        '#ffffff'
      )
    ).toBe(true)
  })

  it('a drawing whose light fills vanish still shows by the dark ink that runs right across it', () => {
    // A white-bodied animal drawn in black: mostly white, and plain to see on white.
    const animal = [
      { color: '#ffffff', share: 0.75, box: [0.05, 0.05, 0.95, 0.95] },
      { color: '#010101', share: 0.16, box: [0, 0, 1, 1] },
    ]
    expect(logoShowsOn(animal, '#ffffff')).toBe(true)
    // A white wordmark beside a coloured mark: what shows is the mark, a fifth of the width.
    const lockup = [
      { color: '#ffffff', share: 0.6, box: [0.25, 0.2, 1, 0.8] },
      { color: '#326ce5', share: 0.29, box: [0, 0, 0.2, 1] },
    ]
    expect(inkExtent(lockup, '#ffffff')).toBeCloseTo(0.2)
    expect(logoShowsOn(lockup, '#ffffff')).toBe(false)
    expect(logoShowsOn(lockup, '#0a0a0a')).toBe(true)
    // Inks that came without their places are judged by their share alone.
    expect(
      logoShowsOn(
        animal.map(({ box: _box, ...ink }) => ink),
        '#ffffff'
      )
    ).toBe(false)
  })

  it('leaves the picture’s own ground out when it melts into the surface', () => {
    // A black drawing on its own white square: on a white page the square is not there.
    const onPlate = [
      { color: '#ffffff', share: 0.75, box: [0, 0, 1, 1], plate: true },
      { color: '#010101', share: 0.16, box: [0.21, 0.12, 0.78, 0.88] },
    ]
    expect(logoShowsOn(onPlate, '#ffffff')).toBe(true)
    // On a dark bar the plate stands off it, and the whole picture shows.
    expect(logoShowsOn(onPlate, '#0a0a0a')).toBe(true)
    // A picture that is all ground says nothing: its markup decides.
    expect(logoShowsOn([{ color: '#000000', share: 1, plate: true }], '#0a0a23')).toBeUndefined()
  })

  it('says nothing for a logo with no inks counted', () => {
    expect(logoShowsOn([], '#ffffff')).toBeUndefined()
    expect(logoShowsOn(undefined, '#ffffff')).toBeUndefined()
    expect(logoShowsOn([{ color: 'not a colour', share: 1 }], '#ffffff')).toBeUndefined()
  })
})
