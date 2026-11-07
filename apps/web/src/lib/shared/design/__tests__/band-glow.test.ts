import { describe, expect, it } from 'vitest'
import { meshBand, veiledFor } from '../band-glow'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import { contrastRatio } from '../contrast'

/** A background's layers, split at its top-level commas. */
function layers(background: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < background.length; i++) {
    const ch = background[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(background.slice(from, i).trim())
      from = i + 1
    }
  }
  return [...out, background.slice(from).trim()]
}

/** The layer that carries the brand's colours, and its colour stops. */
function field(background: string) {
  const coloured = layers(background).filter((layer) => /^linear-gradient\(in oklab /.test(layer))
  expect(coloured).toHaveLength(1)
  const stops = [...coloured[0]!.matchAll(/(#[\da-f]{6}) \d+%/g)].map(([, c]) => c!)
  expect(stops.length).toBeGreaterThanOrEqual(3)
  return stops
}

/** The opening the page's colour leaves for the field: its centre and radii, in percent of the band's box. */
function opening(background: string) {
  const found = [
    ...background.matchAll(
      /radial-gradient\(ellipse (\d+)% (\d+)% at (\d+)% (\d+)%, transparent 0%/g
    ),
  ].map(([, rx, ry, x, y]) => ({ rx: Number(rx), ry: Number(ry), x: Number(x), y: Number(y) }))
  expect(found).toHaveLength(1)
  return found[0]!
}

const PALETTES = {
  // A near-black headline on white with a deep navy glow: the glow must give way.
  'navy on white': {
    page: '#ffffff',
    ink: '#0a0a0a',
    muted: '#525252',
    primary: '#251a52',
    second: '#6e3de9',
  },
  // White words on black with a white glow: the same.
  'white on black': {
    page: '#000000',
    ink: '#ffffff',
    muted: '#a1a1a1',
    primary: '#fefefe',
    second: '#1c1e58',
  },
  // Two near-opposite vivid hues: where they meet must not go grey.
  'blue and orange on white': {
    page: '#ffffff',
    ink: '#0a2540',
    muted: '#425466',
    primary: '#533afb',
    second: '#fd9330',
  },
  'blurple on navy': {
    page: '#131573',
    ink: '#fffffe',
    muted: '#a1a1a1',
    primary: '#6a6db4',
    second: '#0a0c49',
  },
}

describe('a mesh of glows', () => {
  it('keeps a colour as it is where the words read on it, else veils it toward the page', () => {
    const texts = [{ ink: '#0a0a0a', target: 3 }]
    expect(veiledFor('#e58fae', '#ffffff', texts)).toBe('#e58fae')
    const veiled = veiledFor('#251a52', '#ffffff', texts)
    expect(veiled).not.toBe('#251a52')
    expect(contrastRatio('#0a0a0a', veiled)).toBeGreaterThanOrEqual(3)
    // Never past the page itself.
    expect(veiledFor('#000000', '#ffffff', [{ ink: '#000000', target: 21 }])).toBe('#ffffff')
  })

  it('veils a deep colour to a clear lighter tone of itself, not a grey', () => {
    const veiled = parseOklch(
      hexToOklch(veiledFor('#251a52', '#ffffff', [{ ink: '#0a0a0a', target: 3 }]))
    )!
    expect(veiled.c).toBeGreaterThan(0.08)
  })

  it('keeps the colour where two near-opposite hues meet', () => {
    const stops = field(meshBand(PALETTES['blue and orange on white'], false).background)
    const middle = parseOklch(hexToOklch(stops[Math.floor(stops.length / 2)]!))!
    expect(middle.c).toBeGreaterThan(0.12)
  })

  for (const [name, colours] of Object.entries(PALETTES)) {
    for (const centred of [false, true]) {
      const mesh = meshBand(colours, centred)
      const where = `${name}, ${centred ? 'centred' : 'left'}`

      // Beside left-aligned words; centred ones sit in a bloom from the band's corners.
      if (!centred) {
        it(`mixes the brand's colours in one layer, so no two hues lie over each other (${where})`, () => {
          field(mesh.background)
        })

        it(`fades the colour out inside the band's sides (${where})`, () => {
          const g = opening(mesh.background)
          expect(g.x - g.rx, where).toBeGreaterThanOrEqual(0)
          expect(g.x + g.rx, where).toBeLessThanOrEqual(100)
        })

        it(`keeps the headline readable on every colour of the field (${where})`, () => {
          for (const colour of field(mesh.background))
            expect(contrastRatio(colours.ink, colour), where).toBeGreaterThanOrEqual(3)
        })

        it(`lists every colour a header sharing the mesh can sit on (${where})`, () => {
          expect(mesh.across[0]).toBe(colours.page)
          for (const colour of field(mesh.background)) expect(mesh.across).toContain(colour)
        })
      } else {
        it(`keeps the headline readable on every corner glow (${where})`, () => {
          const drawn = [...mesh.background.matchAll(/at \d+% \d+%, (#[\da-f]{6}) 0%/g)].map(
            ([, c]) => c!
          )
          expect(drawn.length).toBeGreaterThanOrEqual(3)
          for (const colour of drawn) {
            expect(contrastRatio(colours.ink, colour), where).toBeGreaterThanOrEqual(3)
            expect(mesh.across).toContain(colour)
          }
        })
      }

      it(`keeps the colour on phones, inside the band, veiled until the subtitle reads on it (${where})`, () => {
        expect(mesh.narrow.endsWith(`, ${colours.page}`)).toBe(true)
        // Inside the band on every side, as a band set in a panel ends at the panel's edge.
        const g = opening(mesh.narrow)
        expect(g.x - g.rx, where).toBeGreaterThanOrEqual(0)
        expect(g.x + g.rx, where).toBeLessThanOrEqual(100)
        expect(g.y - g.ry, where).toBeGreaterThanOrEqual(0)
        expect(g.y + g.ry, where).toBeLessThanOrEqual(100)
        for (const colour of field(mesh.narrow)) {
          expect(contrastRatio(colours.muted, colour), where).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(colours.ink, colour), where).toBeGreaterThanOrEqual(3)
          expect(mesh.behind).toContain(colour)
        }
      })
    }
  }

  it('sizes every ellipse in plain lengths or percentages, as browsers drop a calc() mixing them', () => {
    for (const centred of [false, true]) {
      const mesh = meshBand(PALETTES['navy on white'], centred)
      for (const layers of [mesh.background, mesh.narrow])
        expect(layers).not.toMatch(/ellipse [^,]*calc\(/)
    }
  })

  it('lays the page’s colour under left-aligned words to past the subtitle’s measure', () => {
    const { background } = meshBand(PALETTES['navy on white'], false)
    expect(background).toMatch(
      /^linear-gradient\(90deg, #ffffff calc\(max\(0px, \(100% - var\(--qb-page-max, 72rem\)\) \/ 2\) \+ 1\.5rem \+ 42rem\), transparent /
    )
  })
})
