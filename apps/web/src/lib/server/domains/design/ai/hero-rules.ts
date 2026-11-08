/**
 * The hero decided by rules before the model (hero-family.ts holds the
 * model's prompt and examples). The brief asks for one bold signature
 * moment, usually the hero, so the rules settle the look wherever the
 * evidence is clear; the model, asked twice at once, decides only what they
 * leave open, and its details count only where both answers agree.
 */
import { oklab } from '../extract/color'
import type { HeroSurface } from '../extract/hero-surface'
import type { Behind } from '../extract/kinds'
import { DARK_PAGE } from '../extract/roles-evidence'
import { hexRgb } from '../extract/roles-places'
import type { FamilyCaller } from './brand-brief'
import {
  classifyHero,
  ROLE_WORDS,
  type HERO_ART,
  type HeroAnswer,
  type HeroBand,
  type HeroEvidence,
} from './hero-family'

/** The hero as decided: design values, who decided the look, and why. */
export interface HeroDecision {
  band: HeroBand
  blend: 'linear' | 'mesh' | 'ribbon' | null
  /** A band drawn in a third colour of the logo. */
  colour: 'extra1' | null
  /**
   * A measured colour none of the brand's roles holds, which the band is
   * drawn in (a dark band on a light page; a monochrome brand's glow or
   * graphic): kept as an extra colour of the design. A blend runs into it.
   */
  fill: string | null
  shape: 'full' | 'inset' | 'panel'
  /** A soft glow of light measured on a solid band, and where it sits. */
  glow: 'bottom' | 'top' | 'corner' | null
  /** The glow's measured colour, drawn in a colour of the design's that matches it or kept as an extra one. */
  glowFill: string | null
  art: Exclude<(typeof HERO_ART)[number], 'not_visible'>
  headerOnHero: boolean
  /** Where a band image sits, when the design has one. */
  picture: 'side' | 'edge' | 'cover' | null
  by: 'rule' | 'model' | 'default'
  why: string
}

const lightness = (hex: string) => oklab(hexRgb(hex))[0]
const chroma = (hex: string) => {
  const [, a, b] = oklab(hexRgb(hex))
  return Math.hypot(a, b)
}
const apart = (a: string, b: string) =>
  Math.hypot(...oklab(hexRgb(a)).map((v, i) => v - oklab(hexRgb(b))[i]!))
const near = (a: string | null, b: string | null) => !!a && !!b && apart(a, b) < 0.05

/**
 * A vivid sweep over this much of the hero is a gradient on the measures
 * alone; over SWEEP_AGREED, only where the finder saw a gradient or an
 * illustration behind the headline. A payments site's ribbon covers 0.22 of
 * its hero, a synthetic ribbon beside centred words 0.15; a chat app's pale
 * corner wash and
 * every plain dev hero measure none.
 */
const SWEEP_ALONE = 0.12
const SWEEP_AGREED = 0.05

/**
 * The hero's look, measured and observed together: a vivid gradient sweep
 * the colour tools found counts as a gradient over a reading of plain or of a
 * solid colour (a wide gradient's tiles each look flat), on its own when it is
 * large, with the finder's word when it is smaller. A photo stays a photo.
 */
export function agreedLook(
  measured: HeroEvidence['measured'],
  surface: HeroSurface | null | undefined,
  behind: Behind | null
): HeroEvidence['measured'] {
  const g = surface?.gradient
  if (measured === 'photo' || measured === 'gradient' || !g) return measured
  // A solid fill mostly in one saturated colour, brightening along one edge, stays solid.
  const one = surface?.graphic
  if (measured === 'solid' && one && one.share >= PANEL && g.share < one.share / 2) return measured
  const seen = behind === 'gradient' || behind === 'illustration'
  return g.share >= SWEEP_ALONE || (seen && g.share >= SWEEP_AGREED) ? 'gradient' : measured
}

/**
 * A solid hero is one colour over this much of it however part of it sweeps:
 * a money transfer site's lime panel holds 0.82 of its hero in one colour, a synthetic orange
 * panel lightening toward one edge 0.93 with a sweep of 0.17; a wide
 * two-colour gradient's main colour (0.73) is matched by its sweep (0.75).
 */
const PANEL = 0.5

/**
 * A hero this much in bold colour (saturated, or deep and coloured) is the
 * brand's bold moment however its colour was read: every plain dev and goal
 * hero measures 0.03 or less, the payments site's ribbon 0.28, the money
 * transfer site's lime 0.78, a
 * recoloured dev hero 0.9 and more.
 */
const BOLD_AREA = 0.35

const GRADIENT_WHY = {
  linear: 'a gradient fills the hero behind the headline',
  ribbon: 'a ribbon of colour sweeps past the headline, drawn soft',
  mesh: 'soft colour beside the headline',
} as const

/**
 * A ribbon measured beside the words is drawn as a soft mesh: the approved
 * goal design for the one ribbon among the goal brands (a payments site) is a mesh,
 * and the judges asked to soften the ribbon into a blur (gate 11-02e).
 */
const BLEND_OF = { linear: 'linear', ribbon: 'mesh', mesh: 'mesh' } as const

/**
 * Coloured light over this much of a dark hero is its signature (a glow,
 * lit clouds, beams). Synthetic glows built from dev captures measure 0.2
 * and more; flat dark heroes (an issue tracker's, a music app's) and dark pages in a deep
 * colour measure none.
 */
const GLOW = 0.08

/**
 * A graphic in one saturated colour over this much of a monochrome brand's
 * hero carries its colour: every plain dev and goal hero holds 0.03 or less
 * bold colour.
 */
const GRAPHIC = 0.06

/** A band on a light page this dark is a dark section, whatever its role. */
const LIGHT_PAGE = 0.8
const DARK_BAND = 0.45

/**
 * A flat dark colour over this much of a photo hero is a dark section the
 * picture is set in. Photo heroes on the bench whose dark is the photo's own
 * (shadows, a dark table, a night sky) hold 0.09 of it flat at most (the goal
 * and dev photo heroes 0.07); a picture set beside a black panel 0.3.
 */
const DARK_SECTION = 0.2

/**
 * A photo hero this dark overall (mean OKLab lightness) reads as a dark field
 * on a light page. Measured on the bench, dusky full-bleed photos (people in
 * warm shade, a car under a grey sky, a motion blur) sit 0.40 to 0.45; a
 * sunlit product photo 0.77, and plain light pages 0.9 and over.
 */
const PHOTO_DARK = 0.62

const decision = (band: HeroBand, why: string, over: Partial<HeroDecision> = {}): HeroDecision => ({
  band,
  blend: null,
  colour: null,
  shape: 'full',
  glow: null,
  glowFill: null,
  art: 'none',
  headerOnHero: false,
  picture: null,
  fill: null,
  by: 'rule',
  why,
  ...over,
})

/**
 * A photo hero, which the portal cannot borrow: the signature moment goes to
 * a band in the deeper of the brand's two colours (white words read on it),
 * with the words on a panel of the second colour when the brand uses it as a
 * field, and the picture beside the words when the hero is set in.
 */
function photoHero(ev: HeroEvidence, by: HeroDecision['by']): HeroDecision {
  const deeper = ev.secondColour && lightness(ev.secondColour) < lightness(ev.brandColour) - 0.15
  const band: HeroBand = deeper ? 'support' : 'brand'
  const panel = band === 'brand' && ev.secondField && !!ev.secondColour
  const set = panel || ev.heroInset
  return decision(
    band,
    `the site leads with a photo, which the portal cannot borrow, so the signature moment is a band of ${deeper ? 'the second colour' : 'the brand colour'}${panel ? ', with the words on a panel of the second colour' : ''}`,
    {
      shape: panel ? 'panel' : ev.heroInset ? 'inset' : 'full',
      picture: set ? 'side' : 'cover',
      by,
    }
  )
}

/**
 * The hero's look where the evidence settles it, each rule with its reason;
 * null where it is open to the model.
 */
export function ruleHero(ev: HeroEvidence): HeroDecision | null {
  const out = ruleLook(ev)
  return out && withFrame(withHeader(out, ev), ev)
}

const GLOW_WHERE = {
  bottom: 'rising from its foot',
  top: 'along its top',
  corner: 'in a corner',
} as const

/**
 * The hero's frame and light as measured: a coloured band the site sets into
 * the page (its colour on a panel, the page down both sides) is a panel
 * within it rather than full bleed; a band in one colour lit by a soft glow
 * keeps the glow, where it sits and in its colour. A band with words on a
 * panel of their own stays as it is, as does a band of no colour.
 */
function withFrame(out: HeroDecision, ev: HeroEvidence): HeroDecision {
  const coloured = out.band === 'brand' || out.band === 'support' || out.band === 'blend'
  if (!coloured) return out
  const setIn = !!ev.surface?.setIn && out.shape === 'full'
  const light = out.band !== 'blend' && !out.glow ? ev.surface?.light : null
  if (!setIn && !light) return out
  return {
    ...out,
    ...(setIn ? { shape: 'inset' as const } : {}),
    ...(light ? { glow: light.at, glowFill: light.colour } : {}),
    why: [
      out.why,
      setIn ? 'the hero is set into the page as a panel' : '',
      light ? `a soft ${light.colour} glow lights it, ${GLOW_WHERE[light.at]}` : '',
    ]
      .filter(Boolean)
      .join('; '),
  }
}

/**
 * The header on the hero where the site's header sits on the hero's surface
 * (measured: no step or rule at its foot, the hero's colour reaching it), for
 * a hero with a surface to share; else as decided.
 */
function withHeader(out: HeroDecision, ev: HeroEvidence): HeroDecision {
  const coloured = out.band !== 'none' && out.band !== 'tint'
  return coloured && ev.surface?.joinsHeader === true && !out.headerOnHero
    ? { ...out, headerOnHero: true, why: `${out.why}; the site's header sits on the hero` }
    : out
}

function ruleLook(ev: HeroEvidence): HeroDecision | null {
  const graphic =
    ev.monochrome && ev.surface?.graphic && ev.surface.graphic.share >= GRAPHIC
      ? ev.surface.graphic
      : null
  const darkPage = lightness(ev.page) < DARK_PAGE
  if (ev.measured === 'solid' && ev.measuredColour && ev.measuredRole) {
    if (graphic && chroma(ev.measuredColour) < 0.04)
      return decision(
        'blend',
        `a ${ev.measuredColour} band with a large ${graphic.colour} graphic in it: the band runs into the graphic's colour`,
        { blend: 'linear', fill: graphic.colour, headerOnHero: near(ev.header, ev.measuredColour) }
      )
    const band: HeroBand = ev.measuredRole === 'support' ? 'support' : 'brand'
    return decision(
      band,
      `a solid ${ev.measuredColour} fills the hero behind the headline, ${ROLE_WORDS[ev.measuredRole]}`,
      {
        colour: ev.measuredRole === 'extra1' ? 'extra1' : null,
        headerOnHero: near(ev.header, ev.measuredColour),
      }
    )
  }
  if (
    ev.measured === 'solid' &&
    ev.measuredColour &&
    lightness(ev.page) >= LIGHT_PAGE &&
    lightness(ev.measuredColour) < DARK_BAND &&
    apart(ev.measuredColour, ev.page) >= 0.3
  )
    return decision(
      'brand',
      `a dark ${ev.measuredColour} section holds the headline on the light page: the band is that colour`,
      { fill: ev.measuredColour, headerOnHero: near(ev.header, ev.measuredColour) }
    )
  // A photo hero set in a large flat dark section (the photo on one side, the dark on the
  // other) reads as that dark section on the light page, wherever the finder's box falls:
  // a box taking the header in reads the hero as solid dark, one starting below it as a photo.
  const section = ev.surface?.darkSection
  if (
    (ev.measured === 'photo' || ev.measured === 'solid') &&
    section &&
    section.share >= DARK_SECTION &&
    lightness(ev.page) >= LIGHT_PAGE &&
    apart(section.colour, ev.page) >= 0.3
  )
    return decision(
      'brand',
      `a dark ${section.colour} section holds ${Math.round(section.share * 100)}% of the hero on the light page: the band is that colour`,
      { fill: section.colour, headerOnHero: near(ev.header, section.colour) }
    )
  const glow = ev.surface?.glow
  // A gradient under the words is a line; a photo hero's dark parts are the photo's, not a glow.
  const underWords = ev.measured === 'gradient' && ev.surface?.gradient?.place === 'fill'
  const lit = glow && glow.share >= GLOW && !underWords && ev.measured !== 'photo' ? glow : null
  if (lit && lightness(ev.page) >= LIGHT_PAGE)
    return ev.monochrome
      ? decision(
          'blend',
          `a dark hero section lit by ${lit.colour} on the light page: the ink runs into the glow`,
          { blend: 'linear', fill: lit.colour }
        )
      : decision(
          'brand',
          `a dark ${lit.base} hero section lit by ${lit.colour} on the light page: the band is its dark`,
          { fill: lit.base, headerOnHero: near(ev.header, lit.base) }
        )
  if (lit && darkPage)
    return decision(
      'blend',
      `coloured light (${lit.colour}) glows over ${Math.round(lit.share * 100)}% of the dark hero: a soft mesh ${ev.monochrome ? 'in that colour' : 'in the brand’s colours'} on the dark page`,
      { blend: 'mesh', fill: ev.monochrome ? lit.colour : null }
    )
  if (ev.monochrome && ev.measured !== 'solid') {
    // A dark photo filling the hero of a light page is the site's bold moment, not a plain page.
    const tone = ev.measured === 'photo' ? ev.surface?.tone : null
    if (tone && tone.lightness < PHOTO_DARK && lightness(ev.page) >= LIGHT_PAGE)
      return {
        ...photoHero(ev, 'rule'),
        band: 'brand',
        fill: tone.dark,
        why: `a dark photo fills the hero of a monochrome site, which the portal cannot borrow: a band in the photo's dark (${tone.dark})`,
      }
    if (graphic)
      return decision(
        'tint',
        `a large ${graphic.colour} graphic is the only colour on a monochrome site: a tint of it behind the words`,
        { fill: graphic.colour }
      )
    // A gradient behind the words is the one colour a monochrome site shows: a tint of it.
    const sweep = ev.measured === 'gradient' ? ev.surface?.vividColour : null
    return sweep
      ? decision(
          'tint',
          `a ${sweep} gradient is the only colour on a monochrome site: a tint of it behind the words`,
          { fill: sweep }
        )
      : decision('none', 'a monochrome site: no coloured hero')
  }
  if (ev.measured === 'gradient') {
    const form = ev.surface?.gradient?.form
    return decision('blend', form ? GRADIENT_WHY[form] : 'a gradient behind the headline', {
      blend: form ? BLEND_OF[form] : 'mesh',
    })
  }
  if (ev.roleSurface) {
    const band: HeroBand = ev.roleSurface.role === 'support' ? 'support' : 'brand'
    return decision(
      band,
      `${ROLE_WORDS[ev.roleSurface.role]} fills ${Math.round(ev.roleSurface.coverage * 100)}% of the page: the brand's bold moment, carried by the hero`
    )
  }
  if (ev.measured === 'photo' || (ev.behind === 'photo' && ev.measured !== 'solid'))
    return photoHero(ev, 'rule')
  const bold = ev.surface
  // A dark page in a deep colour is the page, not a bold hero.
  if (
    !ev.monochrome &&
    bold &&
    bold.vivid >= BOLD_AREA &&
    bold.vividColour &&
    !(darkPage && apart(bold.vividColour, ev.page) < 0.08)
  ) {
    const colour = bold.vividColour
    const second =
      !!ev.secondColour &&
      apart(colour, ev.secondColour) < 0.08 &&
      apart(colour, ev.secondColour) < apart(colour, ev.brandColour)
    return decision(
      second ? 'support' : 'brand',
      `the hero is bold with colour (${Math.round(bold.vivid * 100)}% of it in ${colour} and the like): the signature moment, in ${second ? 'the second colour' : 'the brand colour'}`
    )
  }
  if (
    ev.measured === 'solid' &&
    ev.measuredColour &&
    lightness(ev.measuredColour) > 0.85 &&
    chroma(ev.measuredColour) < 0.08
  )
    return decision('tint', `a pale ${ev.measuredColour} wash behind the headline`)
  // A drawn graphic in the brand colour is the colour the plain page shows: a tint of it.
  const drawn = ev.surface?.graphic
  if (
    (ev.measured === 'plain' || ev.measured === 'none') &&
    drawn &&
    drawn.share >= GRAPHIC &&
    apart(drawn.colour, ev.brandColour) < 0.08
  )
    return decision(
      'tint',
      `a large ${drawn.colour} graphic in the brand colour on the plain page: a tint of it behind the words`
    )
  if (
    (ev.measured === 'plain' || ev.measured === 'none') &&
    (ev.behind === 'plain' || ev.behind === 'tinted' || ev.behind === null) &&
    ev.intensity !== 'bold'
  )
    return decision('none', 'a plain page behind the headline, and no large brand colour on it')
  return null
}

/** The measured default where neither rules nor the model settle the look. */
export function defaultHero(ev: HeroEvidence): HeroDecision {
  const band: HeroBand = ev.monochrome
    ? 'none'
    : ev.intensity === 'bold'
      ? 'brand'
      : ev.intensity === 'medium'
        ? 'tint'
        : 'none'
  return decision(band, `the brand colour's coverage: the interface is ${ev.intensity} with it`, {
    by: 'default',
  })
}

/** The look an agreed answer names, as a decision. */
function fromLook(ev: HeroEvidence, look: HeroAnswer['look'], said: string): HeroDecision | null {
  const why = `the hero: ${said}`
  const by = 'model' as const
  if (look === 'photo') return ev.monochrome ? null : { ...photoHero(ev, by), why }
  if (ev.monochrome && look !== 'plain_page' && look !== 'pale_tint') return null
  switch (look) {
    case 'plain_page':
      return decision('none', why, { by })
    case 'pale_tint':
      return decision('tint', why, { by })
    case 'soft_fade':
      return decision('fade', why, { by })
    case 'solid_brand_colour':
      return decision('brand', why, { by })
    case 'solid_second_colour':
      return decision(ev.secondColour ? 'support' : 'brand', why, { by })
    case 'bold_gradient':
      return decision('blend', why, { by, blend: 'linear' })
    case 'soft_gradient_beside_words':
      return decision('blend', why, { by, blend: 'mesh' })
    default:
      return null
  }
}

const SHAPE = {
  edge_to_edge: 'full',
  rounded_card_inset: 'inset',
  words_on_a_panel: 'panel',
} as const
const PICTURE = { beside_words: 'side', along_bottom: 'edge', behind_words: 'cover' } as const

/**
 * The hero: rules first; the model, asked twice at once, only for what they
 * leave open and for the details, each taken only where both answers agree.
 * Throws only when the rules leave the look open and no answer came back.
 */
export async function decideHero(
  ev: HeroEvidence,
  call: FamilyCaller,
  crop: Uint8Array | null
): Promise<HeroDecision> {
  const ruled = ruleHero(ev)
  // A plain page needs nothing more.
  if (ruled?.band === 'none') return ruled
  const settled = await Promise.allSettled(
    [0, 1].map((sample) => classifyHero(ev, call, crop, { settled: ruled?.band, sample }))
  )
  const answers = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  // Nothing settled and no answer: the caller falls back, and says so.
  if (!ruled && !answers.length && settled[0]?.status === 'rejected') throw settled[0].reason
  const [a, b] = answers
  const sure = a && b && a.confidence === 'high' && b.confidence === 'high'
  const agreed = <K extends 'look' | 'shape' | 'art' | 'picture' | 'header_on_hero'>(
    key: K
  ): Exclude<HeroAnswer[K], 'not_visible'> | null =>
    sure && a[key] === b[key] && a[key] !== 'not_visible'
      ? (a[key] as Exclude<HeroAnswer[K], 'not_visible'>)
      : null

  let out: HeroDecision
  if (ruled) out = ruled
  else {
    const look = agreed('look')
    out = (look && fromLook(ev, look, a!.evidence)) || defaultHero(ev)
    const header = agreed('header_on_hero')
    if (out.by === 'model' && header) out = { ...out, headerOnHero: header === 'shares_colour' }
    out = withHeader(out, ev)
  }
  if (out.band === 'none') return out
  // The details both answers agree on, where the rules left them.
  // A form the colour tools measured stands; without one, two answers on a bold sweep make it a line.
  if (
    out.band === 'blend' &&
    out.by === 'rule' &&
    !ev.surface?.gradient &&
    agreed('look') === 'bold_gradient'
  )
    out = { ...out, blend: 'linear' }
  const shape = agreed('shape')
  const coloured = out.band === 'brand' || out.band === 'support' || out.band === 'blend'
  const panelOnBlend = shape === 'words_on_a_panel' && out.band === 'blend'
  if (shape && out.shape !== 'panel' && coloured && !panelOnBlend)
    out = { ...out, shape: SHAPE[shape] }
  const art = agreed('art')
  if (art) out = { ...out, art }
  // A panel measured stands over two answers calling the hero edge to edge.
  out = withFrame(out, ev)
  const picture = agreed('picture')
  if (out.shape === 'inset' || out.shape === 'panel') {
    if (out.picture === 'cover') out = { ...out, picture: 'side' }
  } else if (picture && picture !== 'none') out = { ...out, picture: PICTURE[picture] }
  return out
}

export { heroSignals, type HeroGeometry } from './hero-signals'
