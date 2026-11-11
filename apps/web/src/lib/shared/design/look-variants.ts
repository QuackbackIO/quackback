/**
 * STAND-IN: a minimal version of the look variants engine, so the Compare
 * looks chooser can be built and tested before the engine lands. The engine
 * branch replaces this file whole; only the exports below are the contract.
 *
 * Three looks of one brand: Matched (the design as it is), Soft and Vivid.
 * Each keeps the brand's colours, fonts and words and changes the treatment.
 * It imports types only: Compare looks loads it in its own chunk, where an
 * import of a module the builder's first open also loads would split that
 * module into a request of its own (see looks-kit.ts).
 */
import type { PortalDesign } from './schema'

export type LookVariantId = 'matched' | 'soft' | 'vivid'

export interface LookVariant {
  id: LookVariantId
  design: PortalDesign
}

/** Stand-in rules: Soft tints the hero with round corners, Vivid fills it with the brand colour. */
function variantOf(design: PortalDesign, id: Exclude<LookVariantId, 'matched'>): PortalDesign {
  const next = structuredClone(design)
  if (id === 'soft') {
    next.layout.hero = 'tint'
    next.shape.corners = 'pill'
  } else {
    next.layout.hero = 'brand'
    next.shape.corners = 'subtle'
  }
  return next
}

/** The three looks of a design, Matched first and unchanged. */
export function lookVariants(design: PortalDesign): LookVariant[] {
  return [
    { id: 'matched', design },
    { id: 'soft', design: variantOf(design, 'soft') },
    { id: 'vivid', design: variantOf(design, 'vivid') },
  ]
}

/** Which of a base design's looks a design has now, or null when it has none of them. */
export function currentVariant(design: PortalDesign, base: PortalDesign): LookVariantId | null {
  for (const variant of lookVariants(base)) {
    if (
      variant.design.layout.hero === design.layout.hero &&
      variant.design.shape.corners === design.shape.corners
    )
      return variant.id
  }
  return null
}
