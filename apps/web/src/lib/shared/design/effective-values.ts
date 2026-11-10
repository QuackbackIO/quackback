/**
 * A design's effective values: its exact values, else what its choices give
 * at desktop width, for showing what an empty exact value means and for
 * telling Quackback AI the steps the choices take.
 */
import type { PortalDesign } from './schema'
import { tuneHexes } from './tune'

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

/** The design's own values for each role a reader measures. */
export function effectiveValues(design: PortalDesign) {
  const tune = tuneHexes(design) ?? {}
  const fonts = design.brand.fonts
  const radii = RADII_PX[design.shape.corners]
  const buttons = design.shape.buttons ?? 'match'
  return {
    headline: {
      size: tune.headline?.size ?? HEADLINE_PX[fonts.scale ?? 'standard'],
      weight: tune.headline?.weight ?? fonts.headingWeight,
      tracking: tune.headline?.tracking ?? TRACKING_EM[fonts.tracking ?? 'normal'],
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
