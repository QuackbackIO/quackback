/**
 * A design's look: its mode, colours, fonts, shape, layout, exact values and
 * element looks (style, styleDark, stylePhone),
 * apart from its pages, menu, words and logo. A workspace keeps its own looks
 * beside the presets. Taking one gives the draft its treatment (shape,
 * layout, hero, type and exact values) and keeps the brand's own colours,
 * fonts and mode, so a look never undoes a brand match; the look's colours
 * come too only when asked.
 */
import type { PortalDesign } from './schema'
import { COLOUR_PROPS } from './style-tokens'

export interface DesignLook {
  mode: PortalDesign['mode']
  brand: {
    light: PortalDesign['brand']['light']
    dark?: PortalDesign['brand']['dark']
    fonts: PortalDesign['brand']['fonts']
  }
  shape: PortalDesign['shape']
  layout: PortalDesign['layout']
  tune?: PortalDesign['tune']
  /** Elements' own looks; a look saved before these were carried has none. */
  style?: PortalDesign['style']
  styleDark?: PortalDesign['styleDark']
  stylePhone?: PortalDesign['stylePhone']
}

/** The brand-wide style sheets a look carries. */
const SHEETS = ['style', 'styleDark', 'stylePhone'] as const

/** How many looks a workspace keeps. */
export const SAVED_LOOKS_MAX = 5

/** The look a design has, as a copy. */
export function lookOf(design: PortalDesign): DesignLook {
  const { light, dark, fonts } = design.brand
  const layout = { ...design.layout }
  // What post cards show is about content, not look.
  delete layout.postCardHides
  return structuredClone({
    mode: design.mode,
    brand: { light, ...(dark ? { dark } : {}), fonts },
    shape: design.shape,
    layout,
    ...(design.tune ? { tune: design.tune } : {}),
    ...Object.fromEntries(SHEETS.filter((k) => design[k]).map((k) => [k, design[k]])),
  })
}

/** How a look is taken: by default the draft keeps its own colours, fonts and mode. */
export interface TakeLook {
  /** Take the look's colours, fonts and mode as well. */
  itsColours?: boolean
}

/**
 * The design with a look. Its pages, menu, words and logo stay, and so does
 * what its post cards show. Its colours (light, dark and exact), fonts and
 * mode stay too, unless the look's colours are asked for. Other exact values
 * come from the look: one without them leaves none, since they would quietly
 * override its choices.
 */
export function withLook(
  design: PortalDesign,
  look: DesignLook,
  { itsColours = false }: TakeLook = {}
): PortalDesign {
  const next = wholeLook(design, look)
  if (itsColours) return next
  const kept = keepOwn(next, design, { colours: true, fonts: true })
  kept.mode = design.mode
  return kept
}

/** The design with all of a look, its colours and fonts included. */
function wholeLook(design: PortalDesign, look: DesignLook): PortalDesign {
  const next = structuredClone(design)
  const { mode, brand, shape, layout, tune } = structuredClone(look)
  next.mode = mode
  next.brand.light = brand.light
  next.brand.fonts = brand.fonts
  if (brand.dark) next.brand.dark = brand.dark
  else delete next.brand.dark
  next.shape = shape
  next.layout = { ...layout }
  delete next.layout.postCardHides
  if (design.layout.postCardHides) next.layout.postCardHides = design.layout.postCardHides
  if (tune) next.tune = tune
  else delete next.tune
  // Element looks are exact values too: one without them leaves none.
  for (const sheet of SHEETS) {
    const value = structuredClone(look[sheet])
    if (value) (next as Record<string, unknown>)[sheet] = value
    else delete next[sheet]
  }
  return next
}

/** What of a draft's own look to keep when another look is taken. */
export interface KeepOwn {
  colours?: boolean
  fonts?: boolean
}

/** The exact values that are colours, which keeping colours keeps. */
const TUNED_COLOURS = {
  headline: ['colour'],
  subtitle: ['colour'],
  heading: ['colour'],
  link: ['colour'],
  button: ['fill', 'ink'],
} as const

/**
 * A new look with the colours or fonts a draft had, where asked: its palette
 * in light and dark and its exact colours, or its faces and heading weight.
 * Everything else is the new look's.
 */
export function keepOwn(look: PortalDesign, own: PortalDesign, keep: KeepOwn): PortalDesign {
  if (!keep.colours && !keep.fonts) return look
  const next = structuredClone(look)
  if (keep.colours) {
    next.brand.light = structuredClone(own.brand.light)
    if (own.brand.dark) next.brand.dark = structuredClone(own.brand.dark)
    else delete next.brand.dark
    const tune = { ...next.tune } as Record<string, Record<string, unknown> | undefined>
    for (const [part, keys] of Object.entries(TUNED_COLOURS)) {
      const group = { ...tune[part] }
      for (const key of keys) {
        const value = (own.tune as Record<string, Record<string, unknown> | undefined>)?.[part]?.[
          key
        ]
        if (value === undefined) delete group[key]
        else group[key] = value
      }
      if (Object.keys(group).length) tune[part] = group
      else delete tune[part]
    }
    if (Object.keys(tune).length) next.tune = tune as PortalDesign['tune']
    else delete next.tune
    // Dark mode's own sheet holds colours only, so it is the draft's whole.
    if (own.styleDark) next.styleDark = structuredClone(own.styleDark)
    else delete next.styleDark
    keepProps(next, own, 'style', COLOUR_PROPS)
  }
  if (keep.fonts) {
    const { heading, body, display, headingWeight } = own.brand.fonts
    Object.assign(next.brand.fonts, structuredClone({ heading, body, headingWeight }))
    if (display) next.brand.fonts.display = structuredClone(display)
    else delete next.brand.fonts.display
    keepProps(next, own, 'style', ['font'])
    keepProps(next, own, 'stylePhone', ['font'])
  }
  return next
}

type Sheet = Record<string, Record<string, Record<string, unknown> | undefined> | undefined>

/** In one style sheet of `next`, each of `props` as `own` has it, in every element and state. */
function keepProps(
  next: PortalDesign,
  own: PortalDesign,
  sheet: 'style' | 'stylePhone',
  props: readonly string[]
): void {
  const mine = (own[sheet] ?? {}) as Sheet
  const out = structuredClone((next[sheet] ?? {}) as Sheet)
  for (const element of new Set([...Object.keys(out), ...Object.keys(mine)])) {
    const states = { ...out[element] }
    for (const state of new Set([...Object.keys(states), ...Object.keys(mine[element] ?? {})])) {
      const values = { ...states[state] }
      for (const prop of props) {
        const value = mine[element]?.[state]?.[prop]
        if (value === undefined) delete values[prop]
        else values[prop] = structuredClone(value)
      }
      if (Object.keys(values).length) states[state] = values
      else delete states[state]
    }
    if (Object.keys(states).length) out[element] = states
    else delete out[element]
  }
  if (Object.keys(out).length) (next as Record<string, unknown>)[sheet] = out
  else delete next[sheet]
}
