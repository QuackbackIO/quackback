/**
 * The site's mode from its page and header, not its hero: a white page whose
 * hero is one large dark block (a dark poster under a white header, white
 * below) is a light site with a dark hero, never a dark site. A dark page
 * whose hero is the whole screen (header and hero one dark colour), or a dark
 * page with a light card in its hero, stays dark.
 */
import { describe, expect, it } from 'vitest'
import { deltaE00, oklab, parseColor, type RGB } from '../color'
import { chromaOf } from '../colours'
import { contrast } from '../roles-places'
import type { Box, BoxKind } from '../kinds'
import type { Image } from '../png'
import { colourEvidence, decideRoles, siteScheme, type ShotInput } from '../roles'
import { rolesToDesign } from '../roles-design'

type Fill = [number, number, number]
const W = 960
const H = 600

function canvas(bg: Fill): Image {
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { width: W, height: H, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
const mixC = (a: Fill, b: Fill, t: number): Fill =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Fill
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill, under: Fill) {
  for (let x = x0; x + 3 < x1; x += 6) {
    if (Math.floor((x - x0) / 36) % 4 === 3) continue
    rect(img, [x, y0, x + 1, y1], mixC(under, ink, 0.4))
    rect(img, [x + 1, y0, x + 3, y1], ink)
    rect(img, [x + 3, y0, x + 4, y1], mixC(under, ink, 0.6))
  }
}

const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]
const POSTER: Fill = [22, 22, 22]
const NEAR_BLACK: Fill = [8, 9, 10]
const WHITE_INK: Fill = [247, 248, 248]
const SOFT: Fill = [138, 143, 152]
const PALE_CARD: Fill = [244, 244, 246]

const HEADER: Box = [0, 0, W, 64]
const HERO: Box = [0, 64, W, 440]

/**
 * A page: header, hero and the page below, each in its own colour, with a
 * logo and menu in the header, a headline and subtitle in the hero and a
 * section heading and text below it.
 */
function page(o: {
  header: Fill
  headerInk: Fill
  hero: Fill
  heroInk: Fill
  below: Fill
  belowInk: Fill
  card?: Fill
}): ShotInput {
  const img = canvas(o.below)
  rect(img, HEADER, o.header)
  rect(img, HERO, o.hero)
  rect(img, [32, 20, 112, 44], o.headerInk)
  text(img, [400, 26, 600, 38], o.headerInk, o.header)
  let under = o.hero
  if (o.card) {
    rect(img, [48, 110, 700, 300], o.card)
    under = o.card
  }
  text(img, [64, 140, 620, 190], o.heroInk, under)
  text(img, [64, 210, 460, 222], o.heroInk, under)
  text(img, [64, 480, 500, 500], o.belowInk, o.below)
  text(img, [64, 530, 700, 540], o.belowInk, o.below)
  const boxes: Partial<Record<BoxKind, Box | null>> = {
    header: HEADER,
    logo: [32, 20, 112, 44],
    nav_row: [400, 26, 600, 38],
    hero: HERO,
    headline: [64, 140, 620, 190],
    subtitle: [64, 210, 460, 222],
  }
  return { img, boxes, behind: o.card ? 'solid_colour' : 'plain' }
}

const near = (hex: string | null | undefined, c: Fill, de = 4) => {
  expect(hex).toBeTruthy()
  expect(deltaE00(parseColor(hex!) as RGB, c)).toBeLessThan(de)
}

/** White header, a dark poster for a hero, white below it. */
const posterHero = () =>
  page({
    header: WHITE,
    headerInk: INK,
    hero: POSTER,
    heroInk: WHITE_INK,
    below: WHITE,
    belowInk: INK,
  })

describe('the site’s mode', () => {
  it('reads a white page with one dark hero block as light', () => {
    const ev = colourEvidence([posterHero()])
    expect(siteScheme(ev)).toBe('light')
    near(ev.shots[0]!.page?.hex, WHITE)
    // The text is the page's dark text, not the hero's white.
    near(ev.shots[0]!.text?.hex, INK, 10)
  })

  it('keeps the dark hero as a dark hero, and leaves the portal light', () => {
    const roles = decideRoles(colourEvidence([posterHero()]))
    expect(roles.scheme).toBe('light')
    expect(rolesToDesign(roles).mode).toBeUndefined()
    expect(roles.hero.look).toBe('solid')
  })

  it('reads a dark page whose hero fills the screen as dark', () => {
    const ev = colourEvidence([
      page({
        header: NEAR_BLACK,
        headerInk: WHITE_INK,
        hero: NEAR_BLACK,
        heroInk: WHITE_INK,
        below: NEAR_BLACK,
        belowInk: SOFT,
      }),
    ])
    expect(siteScheme(ev)).toBe('dark')
  })

  it('reads a dark page with a light card in its hero as dark', () => {
    const ev = colourEvidence([
      page({
        header: NEAR_BLACK,
        headerInk: WHITE_INK,
        hero: NEAR_BLACK,
        heroInk: INK,
        below: NEAR_BLACK,
        belowInk: WHITE_INK,
        card: PALE_CARD,
      }),
    ])
    expect(siteScheme(ev)).toBe('dark')
  })

  it('reads a dark page with a light hero picture as dark, its text from the page', () => {
    // A near-black page; an inset light hero (a pale picture) carrying the header, a black
    // button and a headline read as dark; white type on the page below. None of the dark
    // inks read on the page, so the page's own white type is the text.
    const PAGE: Fill = [18, 18, 18]
    const PALE: Fill = [196, 204, 204]
    const img = canvas(PAGE)
    const hero: Box = [40, 64, 920, 380]
    rect(img, hero, PALE)
    rect(img, [700, 84, 820, 112], INK)
    text(img, [712, 94, 808, 102], WHITE_INK, INK)
    text(img, [64, 90, 200, 106], INK, PALE)
    text(img, [64, 170, 400, 200], INK, PALE)
    text(img, [64, 244, 300, 252], INK, PALE)
    text(img, [610, 94, 680, 102], INK, PALE)
    text(img, [300, 440, 660, 460], WHITE_INK, PAGE)
    text(img, [200, 500, 760, 512], WHITE_INK, PAGE)
    const shot: ShotInput = {
      img,
      boxes: {
        header: [40, 76, 920, 128],
        logo: [64, 90, 200, 106],
        nav_row: [600, 90, 690, 106],
        hero,
        headline: [56, 150, 600, 230],
        subtitle: [56, 236, 440, 260],
        primary_button: [700, 84, 820, 112],
      },
      behind: 'photo',
    }
    const ev = colourEvidence([shot])
    near(ev.shots[0]!.page?.hex, PAGE)
    expect(siteScheme(ev)).toBe('dark')
    near(ev.ink, WHITE_INK, 10)
    // Even with no type on the page to read, a dark ink that cannot be read on the dark page
    // never makes the site light.
    const unread = {
      ...ev,
      shots: ev.shots.map((s) => ({ ...s, text: { ...s.text!, lab: [0.12, 0, 0] as RGB } })),
    }
    expect(siteScheme(unread)).toBe('dark')
    // And the dark portal's text stays readable on its page.
    const design = rolesToDesign(decideRoles({ ...unread, ink: '#000000' }))
    expect(design.mode).toBe('dark')
    expect(contrast(design.brand.dark!.ink, design.brand.dark!.background)).toBeGreaterThanOrEqual(
      4.5
    )
  })

  it('reads a dark page whose only text read is a grey label as dark', () => {
    // A near-black page whose type read is a mid grey (a search field's placeholder, a caption):
    // far lighter than the page, so it is light type on a dark page, never a light site.
    const PAGE: Fill = [18, 18, 18]
    const ev = colourEvidence([
      page({
        header: PAGE,
        headerInk: WHITE_INK,
        hero: PAGE,
        heroInk: WHITE_INK,
        below: PAGE,
        belowInk: WHITE_INK,
      }),
    ])
    const grey = {
      ...ev,
      shots: ev.shots.map((s) => ({
        ...s,
        settled: undefined,
        text: { ...s.text!, lab: [0.66, 0, 0.01] as RGB },
      })),
    }
    expect(siteScheme(grey)).toBe('dark')
    // On a page a little lighter (a charcoal), the grey still reads as light type.
    const lifted = {
      ...grey,
      shots: grey.shots.map((s) => ({ ...s, page: { ...s.page!, lab: [0.25, 0, 0] as RGB } })),
    }
    expect(siteScheme(lifted)).toBe('dark')
    // The dark portal's ink is light, not the grey: headlines on a dark site are near white.
    const design = rolesToDesign(decideRoles({ ...grey, ink: '#93958e' }))
    expect(design.mode).toBe('dark')
    expect(oklab(parseColor(design.brand.dark!.ink) as RGB)[0]).toBeGreaterThan(0.9)
  })

  it('reads a mid-grey page with dark type as light', () => {
    const ev = colourEvidence([posterHero()])
    const mid = {
      ...ev,
      shots: ev.shots.map((s) => ({
        ...s,
        settled: undefined,
        page: { ...s.page!, lab: [0.38, 0, 0] as RGB },
        text: { ...s.text!, lab: [0.05, 0, 0] as RGB },
      })),
    }
    expect(siteScheme(mid)).toBe('light')
  })

  it('weighs screenshots by how much page each shows outside its hero', () => {
    // A dark poster screenshot and a plain white one: light (two light pages, one dark hero).
    const plain = page({
      header: WHITE,
      headerInk: INK,
      hero: WHITE,
      heroInk: INK,
      below: WHITE,
      belowInk: INK,
    })
    expect(siteScheme(colourEvidence([posterHero(), plain]))).toBe('light')
  })
})

describe('a monochrome dark site’s brand colour on a light page', () => {
  const SLATE: Fill = [29, 42, 56]
  it('is a neutral ink, never the tinted page colour behind its photos', () => {
    const roles = decideRoles(
      colourEvidence([
        page({
          header: SLATE,
          headerInk: WHITE_INK,
          hero: SLATE,
          heroInk: WHITE_INK,
          below: SLATE,
          belowInk: WHITE_INK,
        }),
      ])
    )
    expect(roles.scheme).toBe('dark')
    expect(roles.monochrome).toBe(true)
    const design = rolesToDesign(roles)
    const accent = design.brand.light.accent
    expect(chromaOf(oklab(parseColor(accent) as RGB))).toBeLessThan(0.02)
    expect(contrast(accent, '#ffffff')).toBeGreaterThanOrEqual(3)
    // The dark portal keeps the site's own page.
    near(design.brand.dark?.background, SLATE)
  })

  it('keeps a near-black page as the ink', () => {
    const roles = decideRoles(
      colourEvidence([
        page({
          header: NEAR_BLACK,
          headerInk: WHITE_INK,
          hero: NEAR_BLACK,
          heroInk: WHITE_INK,
          below: NEAR_BLACK,
          belowInk: WHITE_INK,
        }),
      ])
    )
    near(rolesToDesign(roles).brand.light.accent, NEAR_BLACK)
  })
})
