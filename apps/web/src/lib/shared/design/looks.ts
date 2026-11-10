/**
 * A design's look: its mode, colours, fonts, shape, layout and exact values,
 * apart from its pages, menu, words and logo. A workspace keeps its own looks
 * beside the presets and applies one to a draft as it applies a preset.
 */
import type { PortalDesign } from './schema'

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
}

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
  })
}

/**
 * The design with a look. Its pages, menu, words and logo stay, and so does
 * what its post cards show. Exact values come from the look: one without them
 * leaves none, since they would quietly override its choices.
 */
export function withLook(design: PortalDesign, look: DesignLook): PortalDesign {
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
  return next
}
