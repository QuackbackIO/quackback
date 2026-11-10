/**
 * An element's brand layer, as the element panel reads and writes it. An
 * element's own exact value (its tune group's, which nothing else reads) is
 * what every one of its kind has: the panel shows it as set at its widest
 * scope, writes there, and Reset clears it back to the theme, so an exact
 * value never hides behind a style value. Exact values another element
 * shares (the menu's and buttons' label, post cards' and panels' card) and
 * the brand's choices are what a row has from the brand.
 */
import { setTune, type TuneGroupName } from '@/components/admin/settings/appearance/tune-fields'
import { brandValue, writeAt, type ElementContext } from '@/lib/shared/design/override-cascade'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  COLOUR_PROPS,
  STYLE_ELEMENTS,
  type StyleElement,
  type StyleProp,
} from '@/lib/shared/design/style-tokens'
import { tuneSchema } from '@/lib/shared/design/tune'

/** One exact value: its group and key in the tune, and how its value reads as the style's and back. */
export interface ExactRef {
  group: TuneGroupName
  key: string
  read?: (value: unknown) => unknown
  /** A style value as the tune holds it; undefined where it has none. */
  write?: (value: unknown) => unknown
}

const ref = (group: TuneGroupName, key: string, words?: Record<string, string>): ExactRef =>
  words
    ? {
        group,
        key,
        read: (value) => words[String(value)],
        write: (value) => Object.entries(words).find(([, style]) => style === value)?.[0],
      }
    : { group, key }

/** A tune's capitals in the style's words. */
const CASE = { upper: 'upper', sentence: 'none' }
/** A tune's underline in the style's words; on pointer over has none. */
const UNDERLINE = { always: 'underline', never: 'none' }

const TYPE = (group: TuneGroupName) => ({
  size: [ref(group, 'size')],
  weight: [ref(group, 'weight')],
  tracking: [ref(group, 'tracking')],
  leading: [ref(group, 'leading')],
  color: [ref(group, 'colour')],
})

/** Which exact values reach each element's properties, the first one set winning. */
export const EXACT_ROWS: Partial<
  Record<StyleElement, Partial<Record<StyleProp, readonly ExactRef[]>>>
> = {
  headline: TYPE('headline'),
  heading: TYPE('heading'),
  subtitle: {
    size: [ref('subtitle', 'size')],
    weight: [ref('subtitle', 'weight')],
    color: [ref('subtitle', 'colour')],
  },
  body: { size: [ref('body', 'size')], leading: [ref('body', 'leading')] },
  button: {
    radius: [ref('button', 'radius')],
    height: [ref('button', 'height')],
    background: [ref('button', 'fill')],
    color: [ref('button', 'ink')],
    weight: [ref('button', 'weight'), ref('label', 'weight')],
    size: [ref('label', 'size')],
    tracking: [ref('label', 'tracking')],
    case: [ref('button', 'case', CASE)],
  },
  navItem: {
    size: [ref('label', 'size')],
    weight: [ref('label', 'weight')],
    tracking: [ref('label', 'tracking')],
  },
  postCard: {
    radius: [ref('card', 'radius')],
    borderWidth: [ref('card', 'border')],
    shadow: [ref('card', 'shadow')],
  },
  panel: {
    radius: [ref('card', 'radius')],
    borderWidth: [ref('card', 'border')],
    shadow: [ref('card', 'shadow')],
  },
  input: { radius: [ref('field', 'radius')] },
  link: {
    color: [ref('link', 'colour')],
    weight: [ref('link', 'weight')],
    underline: [ref('link', 'underline', UNDERLINE)],
  },
}

/**
 * Each element's own tune group, which reaches only its kind: every one of
 * them has its values. The label group is the menu's and buttons' both, and
 * the card group post cards' and panels' both, so neither is one element's.
 */
const OWN_GROUP: Partial<Record<StyleElement, TuneGroupName>> = {
  headline: 'headline',
  heading: 'heading',
  subtitle: 'subtitle',
  body: 'body',
  button: 'button',
  input: 'field',
  link: 'link',
}

const tuneAt = (design: PortalDesign, { group, key }: ExactRef) =>
  (design.tune?.[group] as Record<string, unknown> | undefined)?.[key]

const readRef = (design: PortalDesign, r: ExactRef) => {
  const value = tuneAt(design, r)
  return value === undefined || !r.read ? value : r.read(value)
}

/** The exact value that holds an element's property for every one of its kind, if one does. */
export function homeOf(element: StyleElement, prop: StyleProp): ExactRef | undefined {
  const group = OWN_GROUP[element]
  return group ? EXACT_ROWS[element]?.[prop]?.find((r) => r.group === group) : undefined
}

/** The exact value another element shares that a design holds for this one's property, in the style's words. */
function sharedExactOf(design: PortalDesign, element: StyleElement, prop: StyleProp): unknown {
  const home = homeOf(element, prop)
  for (const r of EXACT_ROWS[element]?.[prop] ?? []) {
    if (r === home) continue
    const value = readRef(design, r)
    if (value !== undefined) return value
  }
  return undefined
}

/** A design as the theme would draw it without an element's own exact value for a property. */
function withoutHome(design: PortalDesign, element: StyleElement, prop: StyleProp): PortalDesign {
  const home = homeOf(element, prop)
  if (!home || tuneAt(design, home) === undefined) return design
  const group = { ...(design.tune?.[home.group] as Record<string, unknown>) }
  delete group[home.key]
  return { ...design, tune: { ...design.tune, [home.group]: group } }
}

/**
 * What every one of an element's kind has for a property, on all screens in
 * its normal state: its style value, else its own exact value.
 */
export function everywhereValue(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): unknown {
  const style = (design.style?.[element]?.base as Record<string, unknown> | undefined)?.[prop]
  if (style !== undefined) return style
  const home = homeOf(element, prop)
  return home ? readRef(design, home) : undefined
}

/** A value as an exact value holds it, in its words and within its group’s bounds; undefined where it cannot. */
function holds(design: PortalDesign, r: ExactRef, value: unknown): unknown {
  const v = r.write ? r.write(value) : value
  if (v === undefined) return undefined
  const fields = { ...(design.tune?.[r.group] as Record<string, unknown> | undefined), [r.key]: v }
  return tuneSchema.shape[r.group].safeParse(fields).success ? v : undefined
}

/**
 * Writes what every one of an element's kind has for a property, on all
 * screens in its normal state, in a draft; undefined clears it back to the
 * theme. A number or choice its own exact value can hold goes there; any
 * other value, and every colour (an exact colour is light mode's only), goes
 * to its style. The other of the two is cleared, so the value has one home.
 */
export function writeEverywhere(
  draft: PortalDesign,
  element: StyleElement,
  prop: StyleProp,
  value: unknown
): void {
  const ctx: ElementContext = { element, part: null, page: null, block: null }
  const home = homeOf(element, prop)
  const exact =
    home && value !== undefined && !(COLOUR_PROPS as readonly string[]).includes(prop)
      ? holds(draft, home, value)
      : undefined
  if (home) setTune(draft, home.group, home.key, exact)
  writeAt(draft, ctx, 'everywhere', 'all', 'base', prop, exact === undefined ? value : undefined)
}

/** How many of an element's own exact values a design holds, for its panel's reset count. */
export function homeValuesOf(design: PortalDesign, element: StyleElement): StyleProp[] {
  return (STYLE_ELEMENTS[element].props as readonly StyleProp[]).filter((prop) => {
    const home = homeOf(element, prop)
    return !!home && tuneAt(design, home) !== undefined
  })
}

/** The brand's choices where they decide a value the cascade's own brand reading leaves out. */
function choiceOf(design: PortalDesign, element: StyleElement, prop: StyleProp) {
  const fonts = design.brand.fonts
  if (prop === 'color' && element === 'headline' && fonts.headlineColour === 'accent')
    return 'accent'
  if (prop === 'case' && (element === 'button' || element === 'navItem'))
    return fonts.labelCase === 'upper' ? 'upper' : undefined
  if (prop === 'case' && element === 'headline')
    return fonts.headlineCase === 'upper' ? 'upper' : undefined
  return undefined
}

/**
 * What an element's property has from the brand, below every one of its
 * kind: an exact value it shares where one is set, else what the brand's
 * choices give. Undefined where the brand's value is not known here.
 */
export function brandOf(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): string | number | undefined {
  const exact = sharedExactOf(design, element, prop)
  if (typeof exact === 'string' || typeof exact === 'number') return exact
  return (
    choiceOf(design, element, prop) ?? brandValue(withoutHome(design, element, prop), element, prop)
  )
}
