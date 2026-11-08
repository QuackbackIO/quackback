/**
 * An element's brand layer, as the element panel reads it: the exact values
 * a design holds for it (its tune), and below those its brand choices. Both
 * are what a row has "from brand"; a value set in the panel writes the
 * element's style over them, so an exact value has one home on screen, its
 * row. A row whose brand value is an exact value says so, and the panel's
 * menu can clear them.
 */
import { setTune, type TuneGroupName } from '@/components/admin/settings/appearance/tune-fields'
import { brandValue } from '@/lib/shared/design/override-cascade'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleElement, StyleProp } from '@/lib/shared/design/style-tokens'

/** One exact value: its group and key in the tune, and how its value reads as the style's. */
export interface ExactRef {
  group: TuneGroupName
  key: string
  read?: (value: unknown) => unknown
}

const ref = (group: TuneGroupName, key: string, read?: ExactRef['read']): ExactRef => ({
  group,
  key,
  read,
})

/** A tune's capitals in the style's words. */
const CASE = (value: unknown) =>
  value === 'upper' ? 'upper' : value === 'sentence' ? 'none' : undefined
/** A tune's underline in the style's words; on pointer over has none. */
const UNDERLINE = (value: unknown) =>
  value === 'always' ? 'underline' : value === 'never' ? 'none' : undefined

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

const tuneAt = (design: PortalDesign, { group, key }: ExactRef) =>
  (design.tune?.[group] as Record<string, unknown> | undefined)?.[key]

/** The exact value a design holds for an element's property, in the style's words. */
export function exactOf(design: PortalDesign, element: StyleElement, prop: StyleProp): unknown {
  for (const r of EXACT_ROWS[element]?.[prop] ?? []) {
    const value = tuneAt(design, r)
    if (value !== undefined) return r.read ? r.read(value) : value
  }
  return undefined
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
 * What an element's property has from the brand: its exact value where one
 * is set, else what the brand's choices give. Undefined where the brand's
 * value is not known here.
 */
export function brandOf(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): string | number | undefined {
  const exact = exactOf(design, element, prop)
  if (typeof exact === 'string' || typeof exact === 'number') return exact
  return choiceOf(design, element, prop) ?? brandValue(design, element, prop)
}

/** The exact values a design holds for an element, once each, in the order its rows read them. */
export function exactValuesOf(design: PortalDesign, element: StyleElement): ExactRef[] {
  const seen = new Set<string>()
  const out: ExactRef[] = []
  for (const refs of Object.values(EXACT_ROWS[element] ?? {}))
    for (const r of refs ?? []) {
      const id = `${r.group}.${r.key}`
      if (seen.has(id) || tuneAt(design, r) === undefined) continue
      seen.add(id)
      out.push(r)
    }
  return out
}

/** Clears an element's exact values in a draft, so its brand choices reach it again. */
export function clearExactValues(draft: PortalDesign, element: StyleElement): void {
  for (const r of exactValuesOf(draft, element)) setTune(draft, r.group, r.key, undefined)
}
