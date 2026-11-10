/**
 * Choices and the exact values that override them. An exact value, such as
 * the headline's size in px, wins over the choice it competes with, such as
 * the headline's scale; picking that choice again means it should count, so
 * the exact value it competes with goes.
 */
import type { PortalDesign } from './schema'
import type { StyleElement, StyleProp } from './style-tokens'

type Tune = NonNullable<PortalDesign['tune']>

/**
 * Each choice, the exact value it competes with, and the brand-wide style
 * (style.<element>.base.<prop>) that draws the same.
 */
const COMPETING: Array<
  [choice: string, group: keyof Tune, key: string, element: StyleElement, prop: StyleProp]
> = [
  ['brand.fonts.scale', 'headline', 'size', 'headline', 'size'],
  ['brand.fonts.tracking', 'headline', 'tracking', 'headline', 'tracking'],
  ['brand.fonts.headlineColour', 'headline', 'colour', 'headline', 'color'],
  ['brand.fonts.headingWeight', 'headline', 'weight', 'headline', 'weight'],
  ['brand.fonts.headingWeight', 'heading', 'weight', 'heading', 'weight'],
  ['brand.fonts.labelCase', 'button', 'case', 'button', 'case'],
  ['shape.buttons', 'button', 'radius', 'button', 'radius'],
  ['shape.fill', 'button', 'fill', 'button', 'background'],
  ['shape.fill', 'button', 'ink', 'button', 'color'],
  ['shape.corners', 'card', 'radius', 'postCard', 'radius'],
  ['shape.corners', 'field', 'radius', 'input', 'radius'],
  ['layout.cards', 'card', 'border', 'postCard', 'borderWidth'],
  ['layout.cards', 'card', 'shadow', 'postCard', 'shadow'],
]

/** The brand-wide style sheets: light, dark's colours and phones' sizes. */
const SHEETS = ['style', 'styleDark', 'stylePhone'] as const

const at = (doc: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      doc
    )

/**
 * Removes from `next` each exact value and brand-wide style a choice changed
 * between `before` and `next` competes with, unless the same change set that
 * value too. Returns what went, as `group.key` or `sheet.element.prop`. The
 * server runs it on every save against the stored draft, so it holds for
 * every writer.
 */
export function releaseOverrides(before: PortalDesign, next: PortalDesign): string[] {
  const released: string[] = []
  for (const [choice, group, key, element, prop] of COMPETING) {
    if (at(before, choice) === at(next, choice)) continue
    for (const sheet of SHEETS) {
      if (releaseStyle(before, next, sheet, element, prop))
        released.push(`${sheet}.${element}.${prop}`)
    }
    const values = next.tune?.[group] as Record<string, unknown> | undefined
    if (values?.[key] === undefined) continue
    if (values[key] !== (before.tune?.[group] as Record<string, unknown> | undefined)?.[key])
      continue
    delete values[key]
    released.push(`${group}.${key}`)
    if (!Object.keys(values).length) delete next.tune![group]
  }
  if (next.tune && !Object.keys(next.tune).length) delete next.tune
  return released
}

/** Removes one brand-wide style value unless this change set it; true when it went. */
function releaseStyle(
  before: PortalDesign,
  next: PortalDesign,
  sheet: (typeof SHEETS)[number],
  element: StyleElement,
  prop: StyleProp
): boolean {
  type Sheet = Record<string, Record<string, Record<string, unknown>> | undefined>
  const nextSheet = next[sheet] as Sheet | undefined
  const base = nextSheet?.[element]?.base
  if (base?.[prop] === undefined) return false
  const was = (before[sheet] as Sheet | undefined)?.[element]?.base?.[prop]
  if (JSON.stringify(was) !== JSON.stringify(base[prop])) return false
  delete base[prop]
  if (!Object.keys(base).length) delete nextSheet![element]!.base
  if (!Object.keys(nextSheet![element]!).length) delete nextSheet![element]
  if (!Object.keys(nextSheet!).length) delete next[sheet]
  return true
}
