/**
 * Theme's Hover tiles, as element Hover values. Lift is how post cards and
 * main buttons look under the pointer, so it is written where those looks
 * live (style.postCard.hover, style.button.hover) and read back from there:
 * one source, never a second motion stacked on an element's own hover.
 * Arrow is a link's own affordance, kept as `shape.hover`.
 */
import type { PortalDesign } from './schema'
import type { StyleProps, StyleSheet } from './style-tokens'

export type HoverTile = 'none' | 'lift' | 'arrow'

/** What Lift writes, as the old motion drew it: up 2px, with a soft shadow below. */
export const LIFT_LOOKS = {
  postCard: { lift: 2, shadow: 'floating' },
  button: { lift: 2, shadow: 'floating' },
} as const satisfies Partial<Record<keyof StyleSheet, StyleProps>>

const LIFTED = Object.keys(LIFT_LOOKS) as Array<keyof typeof LIFT_LOOKS>

/** The tile a design shows: Arrow where links carry one, Lift where post cards rise, else None. */
export function hoverTileOf(design: Pick<PortalDesign, 'shape' | 'style'>): HoverTile {
  if (design.shape.hover === 'arrow') return 'arrow'
  return (design.style?.postCard?.hover?.lift ?? 0) > 0 ? 'lift' : 'none'
}

/** Lift's values on a sheet, each kept where the element already sets its own. */
function addLift(sheet: StyleSheet): StyleSheet {
  const out = { ...sheet } as Record<string, Record<string, StyleProps>>
  for (const element of LIFTED) {
    const own = out[element] ?? {}
    out[element] = { ...own, hover: { ...LIFT_LOOKS[element], ...own.hover } }
  }
  return out as StyleSheet
}

/** A sheet without Lift's values; elements and states left empty are dropped. */
function dropLift(sheet: StyleSheet): StyleSheet | undefined {
  const out = structuredClone(sheet) as Record<string, Record<string, Record<string, unknown>>>
  for (const element of LIFTED) {
    const hover = out[element]?.hover
    if (!hover) continue
    delete hover.lift
    if (hover.shadow === LIFT_LOOKS[element].shadow) delete hover.shadow
    if (!Object.keys(hover).length) delete out[element]!.hover
    if (!Object.keys(out[element]!).length) delete out[element]
  }
  return Object.keys(out).length ? (out as StyleSheet) : undefined
}

/** Writes a Hover tile into a draft: Lift as element values, Arrow as the links' own. */
export function writeHoverTile(draft: PortalDesign, tile: HoverTile): void {
  delete draft.shape.hover
  if (tile === 'arrow') draft.shape.hover = 'arrow'
  const sheet = tile === 'lift' ? addLift(draft.style ?? {}) : dropLift(draft.style ?? {})
  if (sheet) draft.style = sheet
  else delete draft.style
}

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * A design stored when Lift was its own motion (`shape.hover: lift`), with
 * Lift written as the element Hover values it now is; the same document
 * where it has none. The document given stays as it is.
 */
export function withHoverLift(input: Json): Json {
  const shape = input.shape
  if (!isRecord(shape) || shape.hover !== 'lift') return input
  const { hover: _hover, ...rest } = shape
  const style = isRecord(input.style) ? (input.style as StyleSheet) : {}
  return { ...input, shape: rest, style: addLift(style) }
}
