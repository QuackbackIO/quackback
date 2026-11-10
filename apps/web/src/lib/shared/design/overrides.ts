/**
 * Choices and the exact values that override them. An exact value, such as
 * the headline's size in px, wins over the choice it competes with, such as
 * the headline's scale; picking that choice again means it should count, so
 * the exact value it competes with goes.
 */
import type { PortalDesign } from './schema'

type Tune = NonNullable<PortalDesign['tune']>

/** Each choice, and the exact values it competes with. */
const COMPETING: Array<[choice: string, group: keyof Tune, key: string]> = [
  ['brand.fonts.scale', 'headline', 'size'],
  ['brand.fonts.tracking', 'headline', 'tracking'],
  ['brand.fonts.headlineColour', 'headline', 'colour'],
  ['brand.fonts.headingWeight', 'headline', 'weight'],
  ['brand.fonts.headingWeight', 'heading', 'weight'],
  ['brand.fonts.labelCase', 'button', 'case'],
  ['shape.buttons', 'button', 'radius'],
  ['shape.fill', 'button', 'fill'],
  ['shape.fill', 'button', 'ink'],
  ['shape.corners', 'card', 'radius'],
  ['shape.corners', 'field', 'radius'],
  ['layout.cards', 'card', 'border'],
  ['layout.cards', 'card', 'shadow'],
]

const at = (doc: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      doc
    )

/**
 * Removes from `next` each exact value a choice changed between `before` and
 * `next` competes with, unless the same change set that value too. Returns
 * what went, as `group.key`.
 */
export function releaseOverrides(before: PortalDesign, next: PortalDesign): string[] {
  const released: string[] = []
  for (const [choice, group, key] of COMPETING) {
    if (at(before, choice) === at(next, choice)) continue
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
