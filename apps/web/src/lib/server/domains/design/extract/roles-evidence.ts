/**
 * Colour evidence from screenshots: every colour seen on purpose, with where
 * it was seen (logo, main and header buttons, links, the current menu item,
 * badges, the header band, the hero, large sections, cards, a gradient
 * behind the headline, pictures of the product app) and how much of the
 * page's own interface it covers. Photos never count; product pictures
 * count low. The decisions built on it are in roles.ts.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00, type RGB } from './color'
import { boxColours, chromaOf, fillAndInk, labDist, type Swatch } from './colours'
import type { Behind, Box, BoxKind } from './kinds'
import type { Image } from './png'
import { activeNavOf, chromatic, logoField } from './roles-places'

export { chromatic }
export { DARK_PAGE, isLightNeutral, LIGHT_TEXT, NEUTRAL, swatchHex, unitOf } from './roles-tones'
import { area, buttonEvidence, overlap } from './roles-buttons'
import { DARK_PAGE, LIGHT_TEXT, NEUTRAL, swatchHex, unitOf } from './roles-tones'
import { solidShapes } from './shapes'
import { mapColours, regionPalette, surfaceMap, type SurfaceMap } from './surfaces'
import { pageInk, pageOf, textOf, tileIn } from './roles-page'
import { pageTones } from './page-tones'
import { aroundShare, headerOnPhoto, PHOTO_SMOOTH_SHARE, ringColours } from './roles-photo'

/** Where a colour was seen. */
export const SOURCES = [
  'logo_field',
  'logo',
  'button',
  'header_button',
  'second_button',
  'second_button_text',
  'link',
  'active_nav',
  'nav_text',
  'headline',
  'badge',
  'header_band',
  'hero_surface',
  'surface',
  'card',
  'hero_gradient',
  'gradient',
  'product',
] as const
export type Source = (typeof SOURCES)[number]

/** Plain words for each place, for replies and the classifier. */
export const SOURCE_WORDS: Record<Source, string> = {
  logo_field: "fills the logo's shape, with the logo's other colours on it",
  logo: 'in the logo',
  button: 'fills the main button',
  header_button: 'fills a button in the header',
  second_button: 'fills a second button',
  second_button_text: "a second button's label or outline",
  link: 'link text',
  active_nav: 'marks the current menu item',
  nav_text: 'menu text',
  headline: 'headline text',
  badge: 'a small badge or label',
  header_band: 'the header background',
  hero_surface: 'a solid background behind the headline',
  surface: 'a large solid section background',
  card: 'a card background',
  hero_gradient: 'in the gradient behind the headline',
  gradient: 'part of a gradient',
  product: 'inside a picture of the product app',
}

export interface Sighting {
  source: Source
  /** Which screenshot. */
  shot: number
  /** For logo colours, the share of the logo's ink; otherwise 1. */
  share: number
}

export interface Candidate {
  id: string
  hex: string
  rgb: RGB
  lab: RGB
  chroma: number
  lightness: number
  /** Grey or near grey (OKLab chroma under 0.045). */
  neutral: boolean
  sightings: Sighting[]
  /** Share of the screenshots' own interface (photos, gradients and product pictures left out). */
  coverage: number
  /** Share of the product pictures' interface. */
  productCoverage: number
}

export interface MainButton {
  hex: string
  rgb: RGB
  ink: string | null
  source: 'button' | 'header_button'
  /** A light button on a dark or photo hero: the site's inverted call to action. */
  inverted: boolean
}

export interface ShotEvidence {
  page: Swatch | null
  /** How much of the screenshot the page was read from (outside the hero where enough shows), 0 to 1: its weight for the site's mode. */
  pageShare: number
  /** Headline and body text colour. */
  text: Swatch | null
  mainButton: MainButton | null
  /** Link colour from the finder's link box. */
  link: Swatch | null
  activeNav: { hex: string; style: 'colour' | 'pill' | 'underline' } | null
  hero: 'photo' | 'gradient' | 'solid' | 'plain' | 'none'
  heroColour: string | null
  logoColours: string[]
  /** The logo's box, for a crop the classifier can look at. */
  logoBox: Box | null
  /** Still under a pop-up's dark layer. */
  dimmed?: boolean
  /** The scheme the whole screenshot's pixels settle (page-tones.ts), where they are clear. */
  settled?: 'light' | 'dark'
  /** Small vivid colours on the page's own interface (a mark, a highlight, coloured words): under a section's share. */
  spots: Swatch[]
}

export interface ColourEvidence {
  candidates: Candidate[]
  shots: ShotEvidence[]
  page: string
  ink: string
}

/** One screenshot: the image and the finder's snapped boxes. */
export interface ShotInput {
  img: Image
  boxes: Partial<Record<BoxKind, Box | null>>
  /** The finder's observation of what sits behind the headline: a photo's colours never count, a gradient's count as its second colour. */
  behind?: Behind
  /** Still under a pop-up's dark layer (it could not be lifted): its page says little about the site's mode. */
  dimmed?: boolean
}

/** The least of the interface a large solid section covers. */
const SECTION = 0.04

interface RawSighting {
  rgb: RGB
  lab: RGB
  source: Source
  shot: number
  share: number
}

/** Everything one screenshot says about colour, as sightings and a summary. */
function shotEvidence(
  shot: ShotInput,
  index: number,
  raw: RawSighting[],
  maps: { map: SurfaceMap; product: Box | null; photos: Box[] }[]
): ShotEvidence {
  const { img, boxes } = shot
  const u = unitOf(img)
  const add = (s: { rgb: RGB; lab: RGB }, source: Source, share = 1) =>
    raw.push({ rgb: s.rgb, lab: s.lab, source, shot: index, share })
  const map = surfaceMap(img, null, Math.max(4, Math.round(8 * u)))
  const product = boxes.product_screenshot ?? null
  const isUi = (t: number, kind: string) =>
    kind !== 'photo' && kind !== 'gradient' && !tileIn(map, t, product)
  // A photo behind the headline: all of the hero is the photo's, its smooth (blurred) parts
  // too, and so is a header laid over it in the same colours.
  const heroPal = boxes.hero ? regionPalette(img, boxes.hero, map.size) : null
  const photoHero =
    !!heroPal &&
    (heroPal.isPhoto ||
      (shot.behind === 'photo' && heroPal.photo + heroPal.gradient > PHOTO_SMOOTH_SHARE))
  const photos: Box[] = []
  if (photoHero && boxes.hero) {
    photos.push(boxes.hero)
    if (boxes.header && headerOnPhoto(img, boxes.header, boxes.hero, map.size))
      photos.push(boxes.header)
  }
  const inPhoto = (t: number) => photos.some((b) => tileIn(map, t, b))
  maps.push({ map, product, photos })
  const ui = mapColours(map, (t, kind) => isUi(t, kind) && !inPhoto(t))
  const read = pageOf(img, map, isUi, ui.colours[0] ?? null, boxes)
  const pageShare = read.share
  // A screenshot whose pixels are clearly a dark site: its page is their dark, whatever the boxes read.
  const tones = shot.dimmed ? null : pageTones(map)
  const settledDark = tones?.scheme === 'dark'
  const page = settledDark && (!read.page || read.page.lab[0] >= DARK_PAGE) ? tones.page : read.page

  // Text: the headline's, subtitle's or menu's ink that reads on the page.
  const head = fillAndInk(img, boxes.headline ?? null, { mode: 'text' })
  const sub = fillAndInk(img, boxes.subtitle ?? null, { mode: 'text' })
  const navInk = fillAndInk(img, boxes.nav_row ?? null, { mode: 'text' }).ink
  const onPage = pageInk(map, (t, kind) => isUi(t, kind) && !inPhoto(t), page, boxes.hero ?? null)
  const boxText = textOf(img, page, [sub.ink, head.ink, navInk], boxes.header ?? null, onPage)
  // On a dark site, a text read that is not light (a thin grey menu label) gives way to its type's ink.
  const text =
    settledDark && tones.text && (!boxText || boxText.lab[0] <= LIGHT_TEXT) ? tones.text : boxText
  if (head.ink && chromatic(head.ink.lab)) add(head.ink, 'headline')

  // Logo colours, the logo's own background left out.
  const logo = boxColours(img, boxes.logo ?? null, 0.08)
  const logoColours: string[] = []
  // The logo's own colours: not its background, nor the colours around it (a photo behind it).
  const logoRing = boxes.logo ? ringColours(img, boxes.logo) : []
  const own = logo.colours.filter(
    (c) =>
      (!logo.background || labDist(c.lab, logo.background.lab) >= 0.04) &&
      !aroundShare(logoRing, c.lab)
  )
  const field = boxes.logo ? logoField(img, boxes.logo, own) : null
  for (const c of own) {
    if (c === field) add(c, 'logo_field')
    else add(c, 'logo', c.share)
    logoColours.push(c.hex)
  }

  // Buttons: the finder's main button, filled buttons in the header, a second button.
  const { mainButton, taken } = buttonEvidence(img, boxes, page, u, add)
  const header = boxes.header ?? null

  // Links and the menu.
  const lk = fillAndInk(img, boxes.link ?? null, { mode: 'text' })
  const link = lk.ink && lk.contrast > 0.12 ? lk.ink : null
  if (link && chromatic(link.lab)) add(link, 'link')
  let activeNav: ShotEvidence['activeNav'] = null
  if (boxes.nav_row) {
    const nav = fillAndInk(img, boxes.nav_row, { mode: 'text' })
    const behind = regionPalette(img, boxes.nav_row, Math.max(4, Math.round(4 * u)))
    if (nav.ink && chromatic(nav.ink.lab) && behind.photo + behind.gradient < 0.2)
      add(nav.ink, 'nav_text')
    const a = activeNavOf(img, boxes.nav_row, u)
    if (a) {
      add(a, 'active_nav')
      activeNav = { hex: swatchHex(a.rgb), style: a.style }
    }
  }

  // Badges: small labelled chromatic shapes anywhere outside the buttons and logo.
  for (const s of solidShapes(img, null, {
    minHeight: 12 * u,
    maxHeight: 34 * u,
    minAspect: 1,
    maxAspect: 12,
  })) {
    if (chromaOf(s.fill.lab) < 0.06) continue
    if (taken.some((b) => overlap(s.box, b) > 0.3 * area(s.box))) continue
    if (boxes.logo && overlap(s.box, boxes.logo) > 0) continue
    if (product && overlap(s.box, product) > 0.5 * area(s.box)) continue
    if (photos.some((b) => overlap(s.box, b) > 0.5 * area(s.box))) continue
    add(s.fill, 'badge')
  }

  // Surfaces: the hero, the header band, large solid sections, cards.
  let hero: ShotEvidence['hero'] = 'none'
  let heroColour: string | null = null
  if (boxes.hero && heroPal) {
    const pal = heroPal
    const top = pal.colours[0]
    // The finder saw a photo behind the headline: smooth parts of it (a blurred background) are the photo's too.
    if (photoHero) hero = 'photo'
    else if (pal.isGradient || (shot.behind === 'gradient' && pal.gradient > 0.08)) {
      hero = 'gradient'
      const source = shot.behind === 'gradient' ? 'hero_gradient' : 'gradient'
      for (const g of pal.gradientColours.slice(0, 4)) if (chromatic(g.lab)) add(g, source)
    } else if (top && (chromatic(top.lab) || (page && labDist(top.lab, page.lab) > 0.04))) {
      hero = 'solid'
      heroColour = top.hex
      add(top, 'hero_surface')
    } else hero = 'plain'
    if (hero !== 'gradient' && hero !== 'photo' && pal.gradient > 0.12)
      for (const g of pal.gradientColours.slice(0, 4)) if (chromatic(g.lab)) add(g, 'gradient')
  }
  if (header && !photos.includes(header)) {
    const pal = regionPalette(img, header, map.size)
    const top = pal.colours[0]
    // A header on the hero's gradient is that gradient (its pale stop), not a band of its own:
    // it feeds the hero's blend, never the identity.
    const onGradient =
      !!top &&
      hero === 'gradient' &&
      !!heroPal &&
      [...heroPal.gradientColours, ...heroPal.colours.slice(0, 1)].some(
        (g) => deltaE00(g.rgb, top.rgb) < 7
      )
    if (top && onGradient && chromatic(top.lab))
      add(top, shot.behind === 'gradient' ? 'hero_gradient' : 'gradient')
    else if (onGradient) {
      // A neutral stop: nothing to record.
    } else if (top && !pal.isPhoto && page && labDist(top.lab, page.lab) > 0.04 && top.share > 0.5)
      add(top, 'header_band')
    else if (top && !pal.isPhoto && chromatic(top.lab) && top.share > 0.5) add(top, 'header_band')
  }
  // Colours too small for a section: a mark, a small button, coloured words (roles-signature.ts).
  const spots = ui.colours.filter((c) => c.share < SECTION && chromaOf(c.lab) >= 0.1)
  for (const c of ui.colours) {
    if (c.share < SECTION || (page && labDist(c.lab, page.lab) < 0.02)) continue
    if (chromatic(c.lab) || c.lab[0] < 0.4) add(c, 'surface')
  }
  if (boxes.card && !photos.some((b) => overlap(boxes.card!, b) > 0.5 * area(boxes.card!))) {
    const r = fillAndInk(img, boxes.card)
    if (r.fill && page && labDist(r.fill.lab, page.lab) > 0.04 && chromaOf(r.fill.lab) >= 0.04)
      add(r.fill, 'card')
  }

  // The product's own app: its accent counts low, never as the site's.
  if (product) {
    const pal = regionPalette(img, product, map.size)
    for (const c of pal.colours) if (c.share >= 0.02 && chromatic(c.lab)) add(c, 'product', c.share)
  }

  return {
    page,
    pageShare,
    text,
    mainButton,
    link,
    activeNav,
    hero,
    heroColour,
    logoColours,
    logoBox: boxes.logo ?? null,
    ...(shot.dimmed && { dimmed: true }),
    ...(tones?.scheme && { settled: tones.scheme }),
    spots,
  }
}

/**
 * Gather the evidence from up to three screenshots: candidates (sightings
 * merged when they are the same colour to the eye) with where each was
 * seen and how much of the interface it covers.
 */
export function colourEvidence(shots: ShotInput[]): ColourEvidence {
  const raw: RawSighting[] = []
  const maps: { map: SurfaceMap; product: Box | null; photos: Box[] }[] = []
  const summaries = shots.map((s, i) => shotEvidence(s, i, raw, maps))
  // Merge sightings: strong places first, so a candidate is named by its surest colour.
  const order = (s: Source) => SOURCES.indexOf(s)
  raw.sort((a, b) => order(a.source) - order(b.source))
  const groups: { lab: RGB; rgb: RGB; sightings: Sighting[] }[] = []
  for (const r of raw) {
    const g = groups.find((x) => deltaE00(x.rgb, r.rgb) < 7)
    if (g) g.sightings.push({ source: r.source, shot: r.shot, share: r.share })
    else
      groups.push({
        lab: r.lab,
        rgb: r.rgb,
        sightings: [{ source: r.source, shot: r.shot, share: r.share }],
      })
  }
  // Coverage: tiles of the interface whose colour (or text colour) is the candidate's.
  const cover = groups.map(() => ({ ui: 0, prod: 0 }))
  let uiTotal = 0
  let prodTotal = 0
  for (const { map, product, photos } of maps) {
    const px = map.size * map.size
    for (let t = 0; t < map.kind.length; t++) {
      const k = map.kind[t]!
      if (k >= 2 || photos.some((b) => tileIn(map, t, b))) continue
      const inProduct = tileIn(map, t, product)
      if (inProduct) prodTotal += px
      else uiTotal += px
      const main = [map.lab[t * 3]!, map.lab[t * 3 + 1]!, map.lab[t * 3 + 2]!]
      const ink = [map.inkLab[t * 3]!, map.inkLab[t * 3 + 1]!, map.inkLab[t * 3 + 2]!]
      groups.forEach((g, i) => {
        let w = 0
        if (labDist(main, g.lab) < 0.05) w += map.main[t]! * px
        if (k === 1 && labDist(ink, g.lab) < 0.05) w += map.ink[t]! * px
        if (!w) return
        if (inProduct) cover[i]!.prod += w
        else cover[i]!.ui += w
      })
    }
  }
  const candidates: Candidate[] = groups.map((g, i) => ({
    id: `c${i + 1}`,
    hex: swatchHex(g.rgb),
    rgb: [Math.round(g.rgb[0]), Math.round(g.rgb[1]), Math.round(g.rgb[2])],
    lab: g.lab,
    chroma: chromaOf(g.lab),
    lightness: g.lab[0],
    neutral: chromaOf(g.lab) < NEUTRAL || !chromatic(g.lab),
    sightings: g.sightings,
    coverage: uiTotal ? cover[i]!.ui / uiTotal : 0,
    productCoverage: prodTotal ? cover[i]!.prod / prodTotal : 0,
  }))
  const pages = summaries.map((s) => s.page).filter(Boolean) as Swatch[]
  const texts = summaries.map((s) => s.text).filter(Boolean) as Swatch[]
  return {
    candidates,
    shots: summaries,
    page: pages[0]?.hex ?? '#ffffff',
    ink: texts[0]?.hex ?? '#111111',
  }
}
