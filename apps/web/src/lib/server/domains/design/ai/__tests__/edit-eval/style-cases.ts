/**
 * The eval's styling and multi-step cases: states (hover, focus, the current
 * menu item, a vote cast), one Home block's look, a look described by
 * another product, a screenshot to match, and requests that only count when
 * text still reads. Each is judged on what the design draws, read from the
 * design (static-reading.ts) as the eval cannot draw it, and holds its own
 * answer (style-cases.test.ts) so a miss is the model's, never the set's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrastRatio } from '@/lib/shared/design/contrast'
import type { FlatOp } from '@/lib/shared/design/design-ops'
import { changedPaths } from './cases'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { lightness, parseCssColour, shadowStrength } from '@/lib/shared/design/agent/css-values'
import { staticReading } from '@/lib/shared/design/agent/static-reading'
import type { StyleOp } from '@/lib/shared/design/agent/style-ops'
import { STYLE_REGISTRY, type StyleStateId } from '@/lib/shared/design/agent/style-registry'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'

export interface StyleCase {
  name: string
  request: string
  picked?: { scope: 'home' | 'card' | 'button' | 'link'; blockId?: string }
  /** An attached image, as the chat sends it: its colours and the picture. */
  image?: { palette: string[]; image: string }
  /** The operations and styles that make it. */
  ops: FlatOp[]
  styles: StyleOp[]
  check: (after: PortalDesign, before: PortalDesign) => boolean
  touches: readonly string[]
}

const v = (d: PortalDesign, element: string, state: StyleStateId = 'base', block = '') =>
  staticReading(d, STYLE_REGISTRY, { element, state, block })
const colour = (
  d: PortalDesign,
  element: string,
  property: string,
  state: StyleStateId = 'base',
  block = ''
) => {
  const r = v(d, element, state, block)
  const c = parseCssColour(r.values[property])
  return c && c.alpha > 0 ? c.hex : null
}
const L = (hex: string | null) => (hex ? lightness(hex) : NaN)
const n = (value: string | undefined) => parseFloat(value ?? '')
const hue = (hex: string) => parseOklch(hexToOklch(hex))!
/** Two colours alike to the eye: close in lightness, chroma and hue. */
const near = (a: string | null, b: string | null, within = 0.06) => {
  if (!a || !b) return false
  const [x, y] = [hue(a), hue(b)]
  const rad = (h: number) => (h * Math.PI) / 180
  return (
    Math.hypot(
      x.l - y.l,
      x.c * Math.cos(rad(x.h)) - y.c * Math.cos(rad(y.h)),
      x.c * Math.sin(rad(x.h)) - y.c * Math.sin(rad(y.h))
    ) <= within
  )
}
/** Text on its fill (or what is behind it) reads at least `least`:1. */
const readable = (
  d: PortalDesign,
  element: string,
  state: StyleStateId = 'base',
  least = 4.5,
  block = ''
) => {
  const r = v(d, element, state, block)
  const fg = parseCssColour(r.values.color)
  const fill = parseCssColour(r.values.background)
  const bg = fill && fill.alpha > 0.5 ? fill.hex : r.behind
  return !!fg && !!bg && contrastRatio(fg.hex, bg) >= least
}
const darkerOnHover = (d: PortalDesign, element = 'button') =>
  L(colour(d, element, 'background')) - L(colour(d, element, 'background', 'hover')) >= 0.03

/** Where element styles land: the site's tokens, dark mode's own, and a Home block's own look. */
const STYLED = ['style', 'styleDark'] as const
const BLOCK_STYLED = [...STYLED, 'pages.home.blocks'] as const
const STYLE = [...STYLED, 'tune', 'shape', 'layout.cards']
const ACCENT = '#4f46e5'

const shot = () =>
  `data:image/jpeg;base64,${readFileSync(join(import.meta.dirname, 'button-shot.jpg')).toString('base64')}`

const s = (
  element: string,
  property: string,
  value: string,
  state: StyleStateId = 'base',
  block = ''
): StyleOp => ({ element, state, block, property, value })

export const STYLE_CASES: StyleCase[] = [
  {
    name: 'buttons darker on hover',
    request: 'Make the buttons darker on hover',
    ops: [],
    styles: [s('button', 'background', 'darker 15%', 'hover')],
    check: (d) => darkerOnHover(d) && readable(d, 'button', 'hover'),
    touches: STYLED,
  },
  {
    name: 'buttons lift with a shadow on hover',
    request: 'When you hover a button it should lift slightly and get a shadow',
    ops: [],
    styles: [s('button', 'lift', '2', 'hover'), s('button', 'shadow', 'soft', 'hover')],
    check: (d) =>
      n(v(d, 'button', 'hover').values.lift?.split(' ')[1]) < 0 &&
      shadowStrength(v(d, 'button', 'hover').values.shadow).present,
    touches: [...STYLED, 'shape.hover'],
  },
  {
    name: 'links underlined on hover',
    request: 'Underline links only when someone hovers over them',
    ops: [{ op: 'theme', key: 'link.underline', value: 'hover' }],
    styles: [],
    check: (d) =>
      v(d, 'link', 'hover').values['underline'] === 'underline' &&
      v(d, 'link').values['underline'] !== 'underline',
    touches: [...STYLED, 'tune.link'],
  },
  {
    name: 'cards with a subtle shadow',
    request: 'Give the cards a subtle shadow',
    ops: [],
    styles: [s('postCard', 'shadow', 'subtle')],
    check: (d) => {
      const sh = shadowStrength(v(d, 'postCard').values.shadow)
      return sh.present && sh.alpha <= 0.2 && sh.blur <= 16
    },
    touches: STYLE,
  },
  {
    name: 'cards: shadow, no border',
    request: 'Cards with a soft shadow and no border',
    ops: [],
    styles: [s('postCard', 'shadow', 'soft'), s('postCard', 'borderWidth', '0')],
    check: (d) =>
      shadowStrength(v(d, 'postCard').values.shadow).present &&
      n(v(d, 'postCard').values['borderWidth']) === 0,
    touches: STYLE,
  },
  {
    name: 'one block bordered in the brand colour',
    request: 'Give only the roadmap block a thin border in our brand colour',
    ops: [],
    styles: [
      s('block', 'borderWidth', '1', 'base', 'roadmap'),
      s('block', 'borderColor', 'accent', 'base', 'roadmap'),
    ],
    check: (d, before) =>
      n(v(d, 'block', 'base', 'roadmap').values['borderWidth']) >= 1 &&
      near(colour(d, 'block', 'borderColor', 'base', 'roadmap'), ACCENT, 0.08) &&
      // Other blocks as they were.
      JSON.stringify(v(d, 'block', 'base', 'ideas').values) ===
        JSON.stringify(v(before, 'block', 'base', 'ideas').values),
    touches: BLOCK_STYLED,
  },
  {
    name: 'one block tinted',
    request:
      'Make the roadmap block’s background a pale tint of our brand colour, keep the text readable',
    ops: [],
    styles: [s('block', 'background', '#eef2ff', 'base', 'roadmap')],
    check: (d) => {
      const bg = colour(d, 'block', 'background', 'base', 'roadmap')
      return (
        !!bg &&
        L(bg) > 0.85 &&
        hue(bg).c > 0.01 &&
        Math.abs(hue(bg).h - hue(ACCENT).h) < 40 &&
        readable(d, 'block', 'base', 4.5, 'roadmap') &&
        colour(d, 'block', 'background', 'base', 'ideas') !== bg
      )
    },
    touches: BLOCK_STYLED,
  },
  {
    name: 'feel like Tidewell',
    request: 'Make it feel more like Tidewell: dark, tight, subtle borders',
    ops: [
      { op: 'theme', key: 'mode', value: 'dark' },
      { op: 'theme', key: 'darkBackground', value: '#0d0e12' },
      { op: 'theme', key: 'density', value: 'compact' },
      { op: 'theme', key: 'headlineSpacing', value: 'tight' },
      { op: 'theme', key: 'cards', value: 'bordered' },
    ],
    styles: [s('postCard', 'borderColor', '#24252b'), s('postCard', 'shadow', 'none')],
    check: (d) => {
      const page = colour(d, 'page', 'background')
      const edge = colour(d, 'postCard', 'borderColor')
      const card = colour(d, 'postCard', 'background') ?? page
      const tight =
        d.layout.density === 'compact' ||
        d.brand.fonts.tracking === 'tight' ||
        (d.tune?.headline?.tracking ?? 0) < -0.02
      return (
        L(page) < 0.3 &&
        tight &&
        n(v(d, 'postCard').values['borderWidth']) >= 1 &&
        !!edge &&
        !!card &&
        contrastRatio(edge, card) <= 2 &&
        readable(d, 'body') &&
        readable(d, 'page')
      )
    },
    touches: ['mode', 'brand', 'layout', 'shape', 'tune', ...STYLED],
  },
  {
    name: 'match a screenshot’s buttons',
    request: 'Match the button style in this screenshot',
    image: { palette: ['#f5f5f4', '#0a0a0a', '#ffffff'], image: '' },
    ops: [
      { op: 'theme', key: 'button.fill', value: '"#0a0a0a"' },
      { op: 'theme', key: 'buttons', value: 'pill' },
      { op: 'theme', key: 'button.case', value: 'upper' },
    ],
    styles: [],
    check: (d) =>
      L(colour(d, 'button', 'background')) < 0.25 &&
      n(v(d, 'button').values.radius) >= 99 &&
      readable(d, 'button'),
    touches: ['tune', 'shape', 'brand.fonts.labelCase', ...STYLED],
  },
  {
    name: 'pale hover that still reads',
    request: 'Make the buttons turn pale lavender (#e0e7ff) on hover, but keep their text readable',
    ops: [],
    styles: [
      s('button', 'background', '#e0e7ff', 'hover'),
      s('button', 'color', '#312e81', 'hover'),
    ],
    check: (d) =>
      near(colour(d, 'button', 'background', 'hover'), '#e0e7ff', 0.03) &&
      readable(d, 'button', 'hover'),
    touches: STYLED,
  },
  {
    name: 'brand-coloured headline that reads',
    request: 'Put the headline in our brand colour, as long as it stays readable',
    ops: [{ op: 'theme', key: 'headlineColour', value: 'accent' }],
    styles: [],
    check: (d) =>
      d.brand.fonts.headlineColour === 'accent' ||
      (near(colour(d, 'headline', 'color'), ACCENT, 0.08) && readable(d, 'headline', 'base', 3)),
    touches: ['brand.fonts.headlineColour', 'tune.headline', ...STYLED],
  },
  {
    name: 'current menu item bold in the brand colour',
    request: 'Make the current page in the menu bold and in our brand colour',
    ops: [],
    styles: [s('navItem', 'weight', '700', 'current'), s('navItem', 'color', 'accent', 'current')],
    check: (d) =>
      n(v(d, 'navItem', 'current').values['weight']) >= 600 &&
      near(colour(d, 'navItem', 'color', 'current'), ACCENT, 0.1),
    touches: [...STYLED, 'layout.nav'],
  },
  {
    // Focus stays neutral: a thicker edge, never a brand-coloured one.
    name: 'fields edged more thickly when focused',
    request: 'When someone clicks into a field, give it a thicker border',
    ops: [],
    styles: [s('input', 'borderWidth', '2', 'focus')],
    check: (d) => n(v(d, 'input', 'focus').values['borderWidth']) >= 2,
    touches: STYLED,
  },
  {
    name: 'outlined secondary buttons that fill on hover',
    request: 'Outline the secondary buttons in our brand colour and fill them with it on hover',
    ops: [],
    styles: [
      s('secondary', 'borderColor', 'accent'),
      s('secondary', 'color', 'accent'),
      s('secondary', 'background', 'accent', 'hover'),
      s('secondary', 'color', '#ffffff', 'hover'),
    ],
    check: (d) =>
      near(colour(d, 'secondary', 'borderColor'), ACCENT, 0.08) &&
      near(colour(d, 'secondary', 'background', 'hover'), ACCENT, 0.1) &&
      readable(d, 'secondary', 'hover'),
    touches: [...STYLED, 'tune.secondary'],
  },
  {
    name: 'voted boxes filled',
    request: 'Once someone has voted, fill the vote box with our brand colour',
    ops: [],
    styles: [
      s('vote', 'background', 'accent', 'current'),
      s('vote', 'color', '#ffffff', 'current'),
    ],
    check: (d) =>
      near(colour(d, 'vote', 'background', 'current'), ACCENT, 0.1) &&
      readable(d, 'vote', 'current'),
    touches: [...STYLED, 'layout.tint'],
  },
  {
    name: 'rounder cards, pill buttons, darker hover',
    request: 'Rounder cards and pill buttons, and make the buttons a bit darker on hover',
    ops: [{ op: 'theme', key: 'buttons', value: 'pill' }],
    styles: [s('postCard', 'radius', '16'), s('button', 'background', 'darker', 'hover')],
    check: (d, before) =>
      n(v(d, 'postCard').values.radius) > n(v(before, 'postCard').values.radius) &&
      n(v(d, 'button').values.radius) >= 99 &&
      darkerOnHover(d),
    touches: [...STYLED, 'tune', 'shape'],
  },
  {
    name: 'warm page with white hairline cards',
    request: 'Make the page a warm off-white (#f7f3ec) and the cards white with a hairline border',
    ops: [
      { op: 'theme', key: 'background', value: '#f7f3ec' },
      { op: 'theme', key: 'surface', value: '#ffffff' },
      { op: 'theme', key: 'cards', value: 'bordered' },
    ],
    styles: [s('postCard', 'borderWidth', '1')],
    check: (d) =>
      near(colour(d, 'page', 'background'), '#f7f3ec', 0.02) &&
      near(colour(d, 'postCard', 'background'), '#ffffff', 0.02) &&
      n(v(d, 'postCard').values['borderWidth']) >= 1,
    touches: ['brand.light', 'layout.cards', 'tune.card', ...STYLED],
  },
  {
    name: 'picked cards: shadow on hover',
    request: 'Add a soft shadow when hovering these',
    picked: { scope: 'card' },
    ops: [],
    styles: [s('postCard', 'shadow', 'soft', 'hover')],
    check: (d, before) =>
      shadowStrength(v(d, 'postCard', 'hover').values.shadow).present &&
      v(d, 'postCard').values.shadow === v(before, 'postCard').values.shadow,
    touches: STYLED,
  },
]

/** The screenshot the match case attaches. */
export function withImage(c: StyleCase): StyleCase {
  return c.image ? { ...c, image: { ...c.image, image: shot() } } : c
}

/** Whether a design answers a styling case: its rule holds and nothing outside what it touches changed. */
export function judgeStyle(
  c: StyleCase,
  before: PortalDesign,
  after: PortalDesign
): { right: boolean; stray: string[] } {
  const stray = changedPaths(before, after).filter(
    (path) =>
      !c.touches.some(
        (field) => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`)
      )
  )
  let right = false
  try {
    right = c.check(after, before)
  } catch {
    right = false
  }
  return { right: right && stray.length === 0, stray }
}
