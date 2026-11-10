/**
 * The hero decided by rules before the model: a solid colour measured behind
 * the headline, a brand colour filling a large section, a photo hero, a
 * gradient and a genuinely plain page each settle the look without a call;
 * the model only adds what it sees (shape, art, the picture) when two of its
 * answers agree, and decides the look only where the rules leave it open and
 * both answers agree, else the measured default stands.
 */
import { describe, expect, it, vi } from 'vitest'
import { agreedLook, decideHero, heroSignals, ruleHero } from '../hero-rules'
import type { HeroSurface } from '../../extract/hero-surface'
import type { HeroAnswer, HeroEvidence } from '../hero-family'
import type { FamilyCaller } from '../brand-brief'
import type { ColourEvidence, ColourRoles } from '../../extract/roles'

const PLAIN: HeroEvidence = {
  behind: 'plain',
  behindWords: 'the white page',
  measured: 'plain',
  measuredColour: null,
  measuredRole: null,
  brandColour: '#2f5bd3',
  secondColour: null,
  page: '#ffffff',
  header: '#ffffff',
  intensity: 'quiet',
  monochrome: false,
  roleSurface: null,
  secondField: false,
  heroInset: false,
}

/** A hero surface with no bold colour and no sweep. */
const QUIET: HeroSurface = { vivid: 0, vividColour: null, vividRgb: null, gradient: null }

const answer = (over: Partial<HeroAnswer> = {}): HeroAnswer => ({
  evidence: 'seen',
  look: 'plain_page',
  shape: 'edge_to_edge',
  art: 'none',
  header_on_hero: 'separate',
  picture: 'none',
  confidence: 'high',
  ...over,
})

/** A caller giving the answers in turn, counting its calls. */
function caller(...answers: Array<HeroAnswer | Error>) {
  let i = 0
  const fn = vi.fn(async () => {
    const a = answers[Math.min(i++, answers.length - 1)]!
    if (a instanceof Error) throw a
    return a
  })
  return { call: fn as unknown as FamilyCaller, fn }
}

describe('hero rules', () => {
  it('a solid colour measured behind the headline in a role is that band, never plain', () => {
    const lime = {
      ...PLAIN,
      behind: 'solid_colour' as const,
      measured: 'solid' as const,
      measuredColour: '#a4e86f',
      measuredRole: 'support' as const,
      secondColour: '#a4e86f',
      page: '#a4e86f',
      header: '#a3e870',
      intensity: 'bold' as const,
    }
    expect(ruleHero(lime)).toMatchObject({ band: 'support', headerOnBand: true, by: 'rule' })
    expect(ruleHero({ ...lime, measuredRole: 'accent', header: '#ffffff' })).toMatchObject({
      band: 'brand',
      headerOnBand: false,
    })
  })

  it('a brand colour filling a large section of the first screen makes a coloured hero', () => {
    const plum = {
      ...PLAIN,
      behind: 'gradient' as const,
      secondColour: '#4d1a57',
      roleSurface: { role: 'support' as const, coverage: 0.21 },
      intensity: 'medium' as const,
    }
    expect(ruleHero(plum)).toMatchObject({ band: 'support', by: 'rule' })
  })

  it('a photo hero set in a large flat dark section is that dark band, however the hero read', () => {
    const section = { share: 0.3, colour: '#060809', rgb: [6, 8, 9] as [number, number, number] }
    const dark = { ...QUIET, darkSection: section }
    for (const measured of ['photo', 'solid'] as const)
      expect(
        ruleHero({ ...PLAIN, behind: 'photo', measured, page: '#f6f6f6', surface: dark })
      ).toMatchObject({ band: 'brand', fill: '#060809', by: 'rule' })
    // A photo whose dark is its own (shadows, a dark table) keeps the photo's rule.
    expect(
      ruleHero({
        ...PLAIN,
        behind: 'photo',
        measured: 'photo',
        surface: { ...QUIET, darkSection: { ...section, share: 0.08 } },
      })
    ).toMatchObject({ band: 'brand', fill: null })
    // On a dark page the dark is the page.
    expect(
      ruleHero({ ...PLAIN, behind: 'photo', measured: 'photo', page: '#0a0a0a', surface: dark })
    ).toMatchObject({ fill: null })
  })

  it('a photo hero becomes a band in the deeper brand colour, with a panel for a two-colour identity', () => {
    const photo = {
      ...PLAIN,
      behind: 'photo' as const,
      measured: 'photo' as const,
      brandColour: '#1d4fa0',
      secondColour: '#ffd21f',
      secondField: true,
      heroInset: true,
    }
    expect(ruleHero(photo)).toMatchObject({ band: 'brand', shape: 'panel', picture: 'side' })
    // A coral brand with a near-black second colour: the band is the deep one.
    const coral = {
      ...photo,
      brandColour: '#f25a48',
      secondColour: '#0b1a26',
      secondField: false,
      heroInset: false,
    }
    expect(ruleHero(coral)).toMatchObject({ band: 'support', shape: 'full', picture: 'cover' })
    // One brand colour only: the band is it.
    expect(ruleHero({ ...coral, secondColour: null })).toMatchObject({ band: 'brand' })
  })

  it('a monochrome site stays plain unless a coloured hero was measured', () => {
    expect(
      ruleHero({ ...PLAIN, behind: 'photo', measured: 'photo', monochrome: true })
    ).toMatchObject({
      band: 'none',
    })
  })

  it('a gradient hero is a blend; a genuinely plain page stays plain', () => {
    expect(
      ruleHero({ ...PLAIN, behind: 'gradient', measured: 'gradient', secondColour: '#ff8a3d' })
    ).toMatchObject({
      band: 'blend',
      blend: 'mesh',
    })
    expect(ruleHero(PLAIN)).toMatchObject({ band: 'none', by: 'rule' })
    expect(ruleHero({ ...PLAIN, behind: 'tinted', page: '#f8f6f3' })).toMatchObject({
      band: 'none',
    })
  })

  it('a pale solid colour without a role is a tint', () => {
    expect(
      ruleHero({ ...PLAIN, behind: 'tinted', measured: 'solid', measuredColour: '#f6efe2' })
    ).toMatchObject({ band: 'tint' })
  })

  it('leaves the ambiguous to the model', () => {
    expect(ruleHero({ ...PLAIN, behind: 'solid_colour' })).toBeNull()
    expect(ruleHero({ ...PLAIN, behind: 'illustration' })).toBeNull()
    expect(ruleHero({ ...PLAIN, intensity: 'bold' })).toBeNull()
  })

  it('draws a gradient in the form measured: a line under the words, a ribbon or a mesh beside them', () => {
    const gradient = { ...PLAIN, behind: 'gradient' as const, measured: 'gradient' as const }
    const g = (place: 'fill' | 'side', form: 'linear' | 'ribbon' | 'mesh') => ({
      ...gradient,
      surface: { ...QUIET, gradient: { share: 0.3, place, form, angle: 40, elongation: 3 } },
    })
    expect(ruleHero(g('fill', 'linear'))).toMatchObject({ band: 'blend', blend: 'linear' })
    // A ribbon is drawn as a soft mesh: the approved goal's Paylane hero, and the judges' ask.
    expect(ruleHero(g('side', 'ribbon'))).toMatchObject({ band: 'blend', blend: 'mesh' })
    expect(ruleHero(g('side', 'mesh'))).toMatchObject({ band: 'blend', blend: 'mesh' })
  })

  it('a hero bold with colour is a bold band in the brand colour, or the second where it is that', () => {
    const bold = { ...PLAIN, surface: { ...QUIET, vivid: 0.6, vividColour: '#00796b' } }
    expect(ruleHero(bold)).toMatchObject({ band: 'brand', by: 'rule' })
    expect(ruleHero({ ...bold, behind: 'illustration' })).toMatchObject({ band: 'brand' })
    expect(
      ruleHero({ ...bold, secondColour: '#00786a', measured: 'solid', measuredColour: '#00796b' })
    ).toMatchObject({ band: 'support' })
    // Not on a monochrome site, and not for a few bright spots.
    expect(ruleHero({ ...bold, monochrome: true })).toMatchObject({ band: 'none' })
    expect(ruleHero({ ...bold, surface: { ...bold.surface, vivid: 0.1 } })).toMatchObject({
      band: 'none',
    })
  })
})

describe('dark heroes, dark bands and one-colour graphics', () => {
  const DARK: HeroEvidence = {
    ...PLAIN,
    behind: 'plain',
    page: '#12141c',
    header: '#12141c',
    brandColour: '#7c5cff',
  }
  const glow = (share: number, colour = '#6d3fd0') => ({
    ...QUIET,
    glow: { share, colour, rgb: [109, 63, 208] as [number, number, number], base: '#12141c' },
  })

  it('a dark hero lit by a coloured glow is a mesh in the brand’s colours, never plain', () => {
    const out = ruleHero({ ...DARK, surface: glow(0.25) })
    expect(out).toMatchObject({ band: 'blend', blend: 'mesh', fill: null, by: 'rule' })
    expect(out!.why).toMatch(/glow/)
  })

  it('a monochrome dark site’s glow carries the glow’s own colour', () => {
    expect(
      ruleHero({
        ...DARK,
        monochrome: true,
        brandColour: '#fefefe',
        surface: glow(0.25, '#2f6bff'),
      })
    ).toMatchObject({
      band: 'blend',
      blend: 'mesh',
      fill: '#2f6bff',
    })
  })

  it('a dark hero section lit by a glow on a light page keeps its dark and its light', () => {
    const lit = {
      ...PLAIN,
      behind: 'gradient' as const,
      measured: 'gradient' as const,
      surface: { ...glow(0.3, '#97282a'), glow: { ...glow(0.3, '#97282a').glow, base: '#0b0b0d' } },
    }
    // A monochrome site: its ink runs into the glow.
    expect(ruleHero({ ...lit, monochrome: true, brandColour: '#171717' })).toMatchObject({
      band: 'blend',
      blend: 'linear',
      fill: '#97282a',
    })
    // A brand colour of its own: the section's dark is the band.
    expect(ruleHero(lit)).toMatchObject({ band: 'brand', fill: '#0b0b0d' })
    // A photo's warm dark parts are no glow.
    expect(ruleHero({ ...lit, behind: 'photo', measured: 'photo' })).toMatchObject({ fill: null })
  })

  it('a truly flat dark hero stays plain', () => {
    expect(ruleHero({ ...DARK, surface: glow(0.01) })).toMatchObject({ band: 'none' })
    expect(ruleHero({ ...DARK, surface: QUIET })).toMatchObject({ band: 'none' })
  })

  it('a dark page is not the hero’s bold colour', () => {
    const navy = {
      ...DARK,
      page: '#0b1a3a',
      surface: { ...QUIET, vivid: 0.95, vividColour: '#0b1a3a' },
    }
    expect(ruleHero(navy)).toMatchObject({ band: 'none' })
  })

  it('a dark band on a light page is a band in that colour, the header on it where it shares it', () => {
    const teal = {
      ...PLAIN,
      behind: 'solid_colour' as const,
      measured: 'solid' as const,
      measuredColour: '#0f2f35',
      brandColour: '#32e6e0',
    }
    expect(ruleHero(teal)).toMatchObject({ band: 'brand', fill: '#0f2f35', headerOnBand: false })
    expect(ruleHero({ ...teal, header: '#0f2f36' })).toMatchObject({ headerOnBand: true })
    // In a role, the role draws it.
    expect(ruleHero({ ...teal, measuredRole: 'accent' })).toMatchObject({
      band: 'brand',
      fill: null,
    })
  })

  it('a monochrome brand’s large one-colour graphic gives its hero that colour', () => {
    const green = { share: 0.09, colour: '#14c850', rgb: [20, 200, 80] as [number, number, number] }
    const band = {
      ...PLAIN,
      monochrome: true,
      behind: 'solid_colour' as const,
      measured: 'solid' as const,
      measuredColour: '#161616',
      measuredRole: 'accent' as const,
      brandColour: '#000000',
      surface: { ...QUIET, graphic: green },
    }
    // A black band runs into the graphic's colour.
    expect(ruleHero(band)).toMatchObject({ band: 'blend', blend: 'linear', fill: '#14c850' })
    // On the plain page, a tint of it.
    expect(
      ruleHero({
        ...band,
        behind: 'plain',
        measured: 'plain',
        measuredColour: null,
        measuredRole: null,
      })
    ).toMatchObject({ band: 'tint', fill: '#14c850' })
    // A small graphic leaves the hero as it was.
    expect(
      ruleHero({ ...band, surface: { ...QUIET, graphic: { ...green, share: 0.02 } } })
    ).toMatchObject({
      band: 'brand',
      fill: null,
    })
  })
})

describe('a monochrome site with a coloured hero', () => {
  it('a gradient hero is its one colour: a tint of it behind the words, not a plain page', () => {
    const peach = {
      ...PLAIN,
      monochrome: true,
      brandColour: '#171615',
      behind: 'gradient' as const,
      measured: 'gradient' as const,
      surface: {
        ...QUIET,
        vivid: 0.4,
        vividColour: '#f7a76c',
        gradient: {
          share: 0.4,
          place: 'fill' as const,
          form: 'linear' as const,
          angle: 0,
          elongation: 2,
        },
      },
    }
    expect(ruleHero(peach)).toMatchObject({ band: 'tint', fill: '#f7a76c', by: 'rule' })
    // Without a colour to carry, it stays plain.
    expect(ruleHero({ ...peach, surface: { ...peach.surface, vividColour: null } })).toMatchObject({
      band: 'none',
    })
    // A photo stays a monochrome site's plain hero.
    expect(ruleHero({ ...peach, behind: 'photo', measured: 'photo' })).toMatchObject({
      band: 'none',
    })
  })
})

describe('a monochrome site led by a photo', () => {
  const dusk = {
    ...PLAIN,
    monochrome: true,
    brandColour: '#111111',
    behind: 'photo' as const,
    measured: 'photo' as const,
    surface: { ...QUIET, tone: { lightness: 0.42, dark: '#3a2a26' } },
  }

  it('a dark photo filling the hero on a light page is a band in the photo’s dark', () => {
    expect(ruleHero(dusk)).toMatchObject({
      band: 'brand',
      fill: '#3a2a26',
      picture: 'cover',
      by: 'rule',
    })
    // Set in from the page's edges, the picture sits beside the words.
    expect(ruleHero({ ...dusk, heroInset: true })).toMatchObject({
      band: 'brand',
      shape: 'inset',
      picture: 'side',
    })
  })

  it('a bright photo, a dark page or no tone measured keeps the plain hero', () => {
    const day = { ...dusk, surface: { ...QUIET, tone: { lightness: 0.8, dark: '#a9a493' } } }
    expect(ruleHero(day)).toMatchObject({ band: 'none' })
    expect(ruleHero({ ...dusk, page: '#121212' })).toMatchObject({ band: 'none' })
    expect(ruleHero({ ...dusk, surface: QUIET })).toMatchObject({ band: 'none' })
    // Not a photo: a plain monochrome page stays plain however dark it measures.
    expect(ruleHero({ ...dusk, behind: 'plain', measured: 'plain' })).toMatchObject({
      band: 'none',
    })
  })
})

describe('a plain hero with the brand colour drawn large in it', () => {
  it('a graphic in the brand colour on the plain page gives the hero a tint of it', () => {
    const pink = {
      share: 0.07,
      colour: '#f78fe0',
      rgb: [247, 143, 224] as [number, number, number],
    }
    const coins = {
      ...PLAIN,
      behind: 'tinted' as const,
      brandColour: '#fa8ee4',
      intensity: 'medium' as const,
      surface: { ...QUIET, vivid: 0.07, vividColour: '#f78fe0', graphic: pink },
    }
    expect(ruleHero(coins)).toMatchObject({ band: 'tint', by: 'rule' })
    // A few spots of it, or a graphic in another colour, leave the page plain.
    expect(
      ruleHero({ ...coins, surface: { ...coins.surface, graphic: { ...pink, share: 0.03 } } })
    ).toMatchObject({ band: 'none' })
    expect(
      ruleHero({
        ...coins,
        surface: { ...coins.surface, graphic: { ...pink, colour: '#14c850', rgb: [20, 200, 80] } },
      })
    ).toMatchObject({ band: 'none' })
  })
})

describe('the header on the hero', () => {
  const ribbon = {
    ...PLAIN,
    behind: 'gradient' as const,
    measured: 'gradient' as const,
    surface: {
      ...QUIET,
      gradient: {
        share: 0.2,
        place: 'side' as const,
        form: 'ribbon' as const,
        angle: 40,
        elongation: 3,
      },
    },
  }

  it('shares the hero where the site’s header sits on the hero’s surface', () => {
    expect(
      ruleHero({ ...ribbon, surface: { ...ribbon.surface, joinsHeader: true } })
    ).toMatchObject({
      band: 'blend',
      headerOnBand: true,
    })
    expect(
      ruleHero({ ...ribbon, surface: { ...ribbon.surface, joinsHeader: false } })
    ).toMatchObject({
      headerOnBand: false,
    })
    // A plain hero has no surface to share.
    expect(ruleHero({ ...PLAIN, surface: { ...QUIET, joinsHeader: true } })).toMatchObject({
      band: 'none',
      headerOnBand: false,
    })
  })

  it('shares it on a look the model chose too', async () => {
    const open = {
      ...PLAIN,
      behind: 'illustration' as const,
      surface: { ...QUIET, joinsHeader: true },
    }
    const look = answer({ look: 'bold_gradient', header_on_hero: 'separate' })
    expect(await decideHero(open, caller(look, look).call, null)).toMatchObject({
      band: 'blend',
      headerOnBand: true,
    })
  })
})

describe('the measured look, with the finder', () => {
  const sweep = (share: number, place: 'fill' | 'side' = 'side') => ({
    ...QUIET,
    gradient: { share, place, form: 'mesh' as const, angle: 0, elongation: 1 },
  })
  it('a vivid sweep over much of the hero is a gradient, whatever the finder saw', () => {
    expect(agreedLook('plain', sweep(0.2), 'plain')).toBe('gradient')
    expect(agreedLook('solid', sweep(0.3, 'fill'), 'solid_colour')).toBe('gradient')
  })
  it('a smaller sweep is a gradient only where the finder saw one or an illustration', () => {
    expect(agreedLook('plain', sweep(0.06), 'gradient')).toBe('gradient')
    expect(agreedLook('plain', sweep(0.06), 'illustration')).toBe('gradient')
    expect(agreedLook('plain', sweep(0.06), 'plain')).toBe('plain')
    expect(agreedLook('solid', sweep(0.06, 'fill'), 'solid_colour')).toBe('solid')
  })
  it('a hero mostly in one saturated colour stays solid where only part of it sweeps', () => {
    // An orange panel brightening toward one edge: one colour holds 0.93 of the hero, the sweep 0.17.
    const orange = {
      share: 0.93,
      colour: '#fd5d1b',
      rgb: [253, 93, 27] as [number, number, number],
    }
    const panel = { ...sweep(0.17, 'fill'), graphic: orange }
    expect(agreedLook('solid', panel, 'solid_colour')).toBe('solid')
    expect(agreedLook('solid', panel, 'gradient')).toBe('solid')
    // A wide two-colour gradient sweeps over as much as its main colour holds: a gradient.
    expect(
      agreedLook(
        'solid',
        { ...sweep(0.75, 'fill'), graphic: { ...orange, share: 0.73 } },
        'gradient'
      )
    ).toBe('gradient')
    // A one-colour graphic beside plain words is not a solid fill.
    expect(
      agreedLook('plain', { ...sweep(0.2), graphic: { ...orange, share: 0.3 } }, 'plain')
    ).toBe('gradient')
  })
  it('a photo stays a photo, and no sweep leaves the measure as it was', () => {
    expect(agreedLook('photo', sweep(0.5), 'gradient')).toBe('photo')
    expect(agreedLook('gradient', QUIET, 'gradient')).toBe('gradient')
    expect(agreedLook('plain', null, 'gradient')).toBe('plain')
  })
})

describe('deciding the hero', () => {
  it('asks no model for a plain page', async () => {
    const { call, fn } = caller(answer())
    const out = await decideHero(PLAIN, call, null)
    expect(out).toMatchObject({ band: 'none', by: 'rule' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('keeps the rule’s look and takes the details two answers agree on', async () => {
    const photo = { ...PLAIN, behind: 'photo' as const, measured: 'photo' as const }
    const inset = answer({
      look: 'photo',
      shape: 'rounded_card_inset',
      art: 'none',
      picture: 'beside_words',
    })
    const agreed = await decideHero(photo, caller(inset, inset).call, null)
    expect(agreed).toMatchObject({ band: 'brand', shape: 'inset', picture: 'side', by: 'rule' })
    const split = await decideHero(
      photo,
      caller(inset, { ...inset, shape: 'edge_to_edge' }).call,
      null
    )
    expect(split).toMatchObject({ band: 'brand', shape: 'full' })
  })

  it('takes the model’s look where the rules leave it open only when two answers agree', async () => {
    const open = { ...PLAIN, behind: 'solid_colour' as const }
    const solid = answer({ look: 'solid_brand_colour' })
    expect(await decideHero(open, caller(solid, solid).call, null)).toMatchObject({
      band: 'brand',
      by: 'model',
    })
    expect(
      await decideHero(open, caller(solid, answer({ look: 'pale_tint' })).call, null)
    ).toMatchObject({ band: 'none', by: 'default' })
    // No answer at all: the caller falls back to the measured default and says so.
    await expect(decideHero(open, caller(new Error('down')).call, null)).rejects.toThrow('down')
  })

  it('a measured gradient form stands over the model’s bold gradient', async () => {
    const ribbon = {
      ...PLAIN,
      behind: 'gradient' as const,
      measured: 'gradient' as const,
      surface: {
        ...QUIET,
        gradient: {
          share: 0.2,
          place: 'side' as const,
          form: 'ribbon' as const,
          angle: 40,
          elongation: 3,
        },
      },
    }
    const bold = answer({ look: 'bold_gradient' })
    expect(await decideHero(ribbon, caller(bold, bold).call, null)).toMatchObject({
      band: 'blend',
      blend: 'mesh',
    })
    // With no form measured, two answers agreeing on a bold sweep make it a line.
    const unmeasured = { ...ribbon, surface: null }
    expect(await decideHero(unmeasured, caller(bold, bold).call, null)).toMatchObject({
      blend: 'linear',
    })
  })

  it('a rule-settled hero stands when the model fails', async () => {
    const photo = { ...PLAIN, behind: 'photo' as const, measured: 'photo' as const }
    expect(await decideHero(photo, caller(new Error('down')).call, null)).toMatchObject({
      band: 'brand',
      by: 'rule',
    })
  })
})

describe('hero signals', () => {
  const cand = (hex: string, coverage: number, sources: string[], neutral = false) => ({
    hex,
    neutral,
    coverage,
    sightings: sources.map((source) => ({ source, shot: 0, share: 1 })),
  })
  const roles = (identity: string, highlight: string | null) =>
    ({
      identity: { value: identity },
      highlight: { value: highlight },
      monochrome: false,
    }) as unknown as ColourRoles

  it('reads a large section in a brand colour, a second colour used as a field, and an inset hero', () => {
    const ev = {
      candidates: [cand('#2f5bd3', 0.01, ['button']), cand('#ffd21f', 0.002, ['logo', 'badge'])],
    } as unknown as ColourEvidence
    expect(
      heroSignals({ width: 1440, hero: [48, 280, 1392, 900] }, ev, roles('#2f5bd3', '#ffd21f'))
    ).toEqual({
      monochrome: false,
      roleSurface: null,
      secondField: true,
      heroInset: true,
    })
    const band = {
      candidates: [
        cand('#7a0e96', 0.015, ['button']),
        cand('#4d1a57', 0.21, ['surface', 'product']),
      ],
    } as unknown as ColourEvidence
    expect(
      heroSignals({ width: 1440, hero: [0, 90, 1440, 736] }, band, roles('#7a0e96', '#4d1a57'))
    ).toMatchObject({ roleSurface: { role: 'support', coverage: 0.21 }, heroInset: false })
  })
})

describe('a hero set into the page, and lit', () => {
  const ORANGE = {
    ...PLAIN,
    behind: 'solid_colour' as const,
    measured: 'solid' as const,
    measuredColour: '#f97316',
    measuredRole: 'accent' as const,
    brandColour: '#f97316',
    intensity: 'bold' as const,
  }
  const LIGHT = { share: 0.03, colour: '#ffe6a8', rgb: [255, 230, 168] as [number, number, number] }
  const surface = (over: Partial<HeroSurface>): HeroSurface => ({ ...QUIET, vivid: 0.9, ...over })

  it('a solid band set into the page is a panel, and a glow measured in it is drawn where it was', () => {
    const lit = { ...ORANGE, surface: surface({ setIn: 0.007, light: { ...LIGHT, at: 'bottom' } }) }
    expect(ruleHero(lit)).toMatchObject({
      band: 'brand',
      shape: 'inset',
      glow: 'bottom',
      glowFill: '#ffe6a8',
    })
    expect(ruleHero(lit)!.why).toMatch(/set into the page/)
    expect(ruleHero(lit)!.why).toMatch(/glow/)
  })

  it('a solid band at the page’s edges, with no glow, stays as it was', () => {
    const flat = ruleHero({ ...ORANGE, surface: surface({ setIn: null, light: null }) })
    expect(flat).toMatchObject({ band: 'brand', shape: 'full', glow: null, glowFill: null })
    expect(ruleHero(ORANGE)).toMatchObject({ shape: 'full', glow: null })
  })

  it('draws no glow on a band that is not one colour, nor a plain one', () => {
    const gradient = ruleHero({
      ...ORANGE,
      measured: 'gradient',
      surface: surface({
        gradient: { share: 0.4, place: 'fill', form: 'linear', angle: 0, elongation: 1 },
        light: { ...LIGHT, at: 'top' },
        setIn: 0.02,
      }),
    })
    expect(gradient).toMatchObject({ band: 'blend', shape: 'inset', glow: null })
    expect(ruleHero({ ...PLAIN, surface: surface({ vivid: 0, setIn: 0.02 }) })).toMatchObject({
      band: 'none',
      shape: 'full',
    })
  })

  it('keeps a measured panel when both answers call the hero edge to edge', async () => {
    const lit = { ...ORANGE, surface: surface({ setIn: 0.007 }) }
    const edge = answer({ look: 'solid_brand_colour', shape: 'edge_to_edge' })
    expect(await decideHero(lit, caller(edge, edge).call, null)).toMatchObject({
      band: 'brand',
      shape: 'inset',
    })
    // Words on a panel, which the measure cannot tell from a set-in band, stand.
    const panel = answer({ look: 'solid_brand_colour', shape: 'words_on_a_panel' })
    expect(await decideHero(lit, caller(panel, panel).call, null)).toMatchObject({
      shape: 'panel',
    })
  })
})
