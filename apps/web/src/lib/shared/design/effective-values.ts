/**
 * A design's effective values: each element's own look (style.<element>.base),
 * else its exact values, else what its choices give at desktop width, for
 * showing what an empty exact value means and for telling Quackback AI the
 * steps the choices take. The look comes first because it is what the
 * canvas draws: it is written over the exact values and the choices.
 */
import type { PortalDesign } from './schema'
import type { StyleElement, StylePaint, StyleProps } from './style-tokens'
import { TUNE_COLOUR_ROLES, tuneHexes, tuneRoleHex, type TuneColourRole } from './tune'
import { fontValue, shapeValue } from './defaults'

/** What each choice gives at desktop width, in px, as components.ts sets it. */
export const HEADLINE_PX = { standard: 30, large: 48, display: 76 } as const
export const TRACKING_EM = { normal: -0.02, tight: -0.03 } as const
export const RADII_PX = {
  sharp: { control: 0, field: 0, panel: 0 },
  subtle: { control: 4, field: 4, panel: 6 },
  rounded: { control: 999, field: 8, panel: 12 },
  pill: { control: 999, field: 12, panel: 20 },
} as const
export const BUTTON_PX = { square: 0, rounded: 8, pill: 999 } as const
export const HEADING_PX = 18
export const LABEL_PX = 14
export const LABEL_WEIGHT = 500
export const BUTTON_HEIGHT = 36

/** An element's normal look, as the design stores it. */
const lookOf = (design: PortalDesign, element: StyleElement): StyleProps =>
  design.style?.[element]?.base ?? {}

/** A look's fill as one colour: a hex, or a brand colour by its role; a gradient is none. */
function fillHex(design: PortalDesign, paint: StylePaint | undefined): string | undefined {
  if (typeof paint !== 'string') return undefined
  if (paint.startsWith('#')) return paint
  if (paint === 'white') return '#ffffff'
  if (paint === 'black') return '#000000'
  return (TUNE_COLOUR_ROLES as readonly string[]).includes(paint)
    ? tuneRoleHex(design, paint as TuneColourRole)
    : undefined
}

/**
 * What the brand gives each role a reader measures: its exact values, else
 * its choices, at desktop width. No element's own look: what the brand gives
 * is what a look is set over, and where a row's "From brand" comes from.
 */
export function brandValues(design: PortalDesign) {
  const tune = tuneHexes(design) ?? {}
  const fonts = design.brand.fonts
  const radii = RADII_PX[design.shape.corners]
  const buttons = shapeValue(design.shape, 'buttons')
  return {
    headline: {
      size: tune.headline?.size ?? HEADLINE_PX[fontValue(fonts, 'scale')],
      weight: tune.headline?.weight ?? fonts.headingWeight,
      tracking: tune.headline?.tracking ?? TRACKING_EM[fontValue(fonts, 'tracking')],
    },
    heading: {
      size: tune.heading?.size ?? HEADING_PX,
      weight: tune.heading?.weight ?? fonts.headingWeight,
    },
    label: { size: tune.label?.size ?? LABEL_PX, weight: tune.label?.weight ?? LABEL_WEIGHT },
    button: {
      radius: tune.button?.radius ?? (buttons === 'match' ? radii.control : BUTTON_PX[buttons]),
      height: tune.button?.height ?? BUTTON_HEIGHT,
      fill:
        tune.button?.fill ??
        (design.shape.fill === 'ink' ? design.brand.light.ink : design.brand.light.accent),
    },
    card: { radius: tune.card?.radius ?? radii.panel },
    field: { radius: tune.field?.radius ?? radii.field },
  }
}

/** The values the canvas draws each role with at desktop width: each element's own look over the brand's. */
export function effectiveValues(design: PortalDesign): ReturnType<typeof brandValues> {
  const brand = brandValues(design)
  const headline = lookOf(design, 'headline')
  const heading = lookOf(design, 'heading')
  const label = lookOf(design, 'navItem')
  const button = lookOf(design, 'button')
  return {
    headline: {
      size: headline.size ?? brand.headline.size,
      weight: headline.weight ?? brand.headline.weight,
      tracking: headline.tracking ?? brand.headline.tracking,
    },
    heading: {
      size: heading.size ?? brand.heading.size,
      weight: heading.weight ?? brand.heading.weight,
    },
    label: { size: label.size ?? brand.label.size, weight: label.weight ?? brand.label.weight },
    button: {
      radius: button.radius ?? brand.button.radius,
      height: button.height ?? brand.button.height,
      fill: fillHex(design, button.background) ?? brand.button.fill,
    },
    card: { radius: lookOf(design, 'postCard').radius ?? brand.card.radius },
    field: { radius: lookOf(design, 'input').radius ?? brand.field.radius },
  }
}
