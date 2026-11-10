/**
 * Dark sites, on synthetic pages with known answers: a monochrome dark page
 * (light buttons on near black, Tidewell-like), a dark page with one small
 * coloured button, and one with only a coloured link. The site's scheme is
 * read from the page and text, a light button on a dark page is its normal
 * call to action (not an inverted one), the text colour never stands in for
 * a brand colour a site does show, and the mapping gives a dark portal whose
 * brand colour reads on its page in both modes.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { contrastRatio } from '@/lib/shared/design/contrast'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { defaultDesign } from '@/lib/shared/design/schema'
import { colourChanges } from '../../ai/brand-decide'
import { deltaE00, parseColor, type RGB } from '../color'
import type { Box, BoxKind } from '../kinds'
import type { Image } from '../png'
import { colourEvidence, decideRoles, type ColourRoles, type ShotInput } from '../roles'
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

const NEAR_BLACK: Fill = [8, 9, 10]
const WHITE_INK: Fill = [247, 248, 248]
const SOFT: Fill = [138, 143, 152]
const LIGHT_BUTTON: Fill = [229, 229, 230]
const GREEN: Fill = [30, 215, 96]
const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]

const BOX: Record<string, Box> = {
  header: [0, 0, W, 64],
  logo: [32, 20, 112, 44],
  nav_row: [160, 26, 460, 38],
  primary_button: [400, 260, 540, 300],
  link: [580, 270, 700, 282],
  hero: [0, 64, W, 420],
  headline: [64, 140, 620, 190],
  subtitle: [64, 210, 460, 222],
}

interface Spec {
  page: Fill
  ink: Fill
  logo: Fill
  button?: Fill
  buttonInk?: Fill
  link?: Fill
}

function shot(spec: Spec): ShotInput {
  const img = canvas(spec.page)
  rect(img, BOX.logo!, spec.logo)
  text(img, BOX.nav_row!, SOFT, spec.page)
  text(img, BOX.headline!, spec.ink, spec.page)
  text(img, BOX.subtitle!, spec.ink, spec.page)
  if (spec.button) {
    rect(img, BOX.primary_button!, spec.button)
    text(img, [416, 274, 524, 286], spec.buttonInk ?? NEAR_BLACK, spec.button)
  }
  if (spec.link) text(img, BOX.link!, spec.link, spec.page)
  const boxes: Partial<Record<BoxKind, Box | null>> = {
    header: BOX.header!,
    logo: BOX.logo!,
    nav_row: BOX.nav_row!,
    hero: BOX.hero!,
    headline: BOX.headline!,
    subtitle: BOX.subtitle!,
    primary_button: spec.button ? BOX.primary_button! : null,
    link: spec.link ? BOX.link! : null,
  }
  return { img, boxes, behind: 'plain' }
}

const near = (hex: string | null | undefined, c: Fill, de = 4) => {
  expect(hex).toBeTruthy()
  expect(deltaE00(parseColor(hex!) as RGB, c)).toBeLessThan(de)
}

const linearLike = () =>
  decideRoles(
    colourEvidence([
      shot({ page: NEAR_BLACK, ink: WHITE_INK, logo: WHITE_INK, button: LIGHT_BUTTON }),
    ])
  )

/** The draft after a match's colour changes, as the pipeline applies them. */
function applied(roles: ColourRoles) {
  const out = applyDesignChanges(
    defaultDesign(),
    colourChanges(roles, rolesToDesign(roles)).map(({ path, value }) => ({ path, value })),
    'site'
  )
  return out
}

describe('the site’s scheme', () => {
  it('reads a near-black page with light text as a dark site', () => {
    expect(linearLike().scheme).toBe('dark')
  })

  it('reads a white page with dark text as a light site', () => {
    const roles = decideRoles(
      colourEvidence([shot({ page: WHITE, ink: INK, logo: INK, button: INK, buttonInk: WHITE })])
    )
    expect(roles.scheme).toBe('light')
  })
})

describe('colour roles on a dark site', () => {
  it('takes a light button on a dark page as the main button, in the text colour', () => {
    const roles = linearLike()
    expect(roles.monochrome).toBe(true)
    expect(roles.buttons).toBe('ink')
    expect(roles.action.value.role).toBe('ink')
    near(roles.action.value.hex, LIGHT_BUTTON)
    expect(roles.action.by).toBe('rule')
  })

  it('never asks for a main button the roles were given', () => {
    const roles = linearLike()
    const missing = roles.ask?.kind === 'thin' ? roles.ask.missing : []
    expect(missing).not.toContain('main button')
  })

  it('lets one small coloured button win over the text colour', () => {
    const roles = decideRoles(
      colourEvidence([shot({ page: NEAR_BLACK, ink: WHITE_INK, logo: WHITE_INK, button: GREEN })])
    )
    expect(roles.monochrome).toBe(false)
    near(roles.identity.value, GREEN)
    expect(roles.action.value.role).toBe('accent')
  })

  it('lets a single coloured link win over the text colour', () => {
    const roles = decideRoles(
      colourEvidence([shot({ page: NEAR_BLACK, ink: WHITE_INK, logo: WHITE_INK, link: GREEN })])
    )
    expect(roles.monochrome).toBe(false)
    near(roles.identity.value, GREEN)
  })

  it('takes a white button beside a coloured brand on a dark page as the text colour', () => {
    const roles = decideRoles(
      colourEvidence([
        shot({ page: NEAR_BLACK, ink: WHITE_INK, logo: GREEN, button: WHITE, link: GREEN }),
      ])
    )
    near(roles.identity.value, GREEN)
    expect(roles.action.value.role).toBe('ink')
    expect(roles.buttons).toBe('ink')
  })
})

describe('a dark site as a design', () => {
  it('makes the portal dark, with the site’s page and text', () => {
    const roles = linearLike()
    const patch = rolesToDesign(roles)
    expect(patch.mode).toBe('dark')
    near(patch.brand.dark?.background, NEAR_BLACK)
    near(patch.brand.dark?.ink, WHITE_INK)
  })

  it('keeps a monochrome identity visible in both modes, never white on white', () => {
    const { design, refused } = applied(linearLike())
    expect(refused).toEqual([])
    expect(design.mode).toBe('dark')
    const resolved = resolveDesign({ ...design, mode: 'auto' })
    expect(resolved.errors).toEqual([])
    const light = resolved.light!
    const dark = resolved.dark!
    expect(contrastRatio(String(light.primary), String(light.background))).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(String(dark.primary), String(dark.background))).toBeGreaterThanOrEqual(3)
    // The light page keeps dark text: the dark site's text colour is not written into light mode.
    expect(contrastRatio(String(light.foreground), String(light.background))).toBeGreaterThan(4.5)
  })

  it('keeps a genuine brand colour, readable on the dark page', () => {
    const roles = decideRoles(
      colourEvidence([shot({ page: NEAR_BLACK, ink: WHITE_INK, logo: WHITE_INK, button: GREEN })])
    )
    const { design, refused } = applied(roles)
    expect(refused).toEqual([])
    expect(design.mode).toBe('dark')
    const dark = resolveDesign(design).dark!
    near(String(design.brand.dark?.accent ?? design.brand.light.accent), GREEN)
    expect(contrastRatio(String(dark.primary), String(dark.background))).toBeGreaterThanOrEqual(3)
  })

  it('leaves a light site light', () => {
    const roles = decideRoles(
      colourEvidence([shot({ page: WHITE, ink: INK, logo: INK, button: INK, buttonInk: WHITE })])
    )
    expect(rolesToDesign(roles).mode).toBeUndefined()
    const { design } = applied(roles)
    expect(design.mode).not.toBe('dark')
    expect(design.brand.dark).toBeUndefined()
  })

  it('turns a dark portal light again for a light site, and leaves a chosen light mode alone', () => {
    const dark = applied(linearLike()).design
    const roles = decideRoles(
      colourEvidence([shot({ page: WHITE, ink: INK, logo: INK, button: INK, buttonInk: WHITE })])
    )
    const changes = (mode: 'dark' | 'light') =>
      colourChanges(roles, rolesToDesign(roles), mode).map(({ path, value }) => ({ path, value }))
    const again = applyDesignChanges(dark, changes('dark'), 'site')
    expect(again.refused).toEqual([])
    expect(again.design.mode).toBe('auto')
    expect(again.design.brand.dark).toBeUndefined()
    expect(changes('light').some((c) => c.path === 'mode')).toBe(false)
  })
})
