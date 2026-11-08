/**
 * What an optional design field reads as when it is left out, declared once.
 * A field is left out of a design until someone sets it, and a value set back
 * to its default is left out again, so a design reads as it did before it was
 * touched. Read such a field through the accessors here, never with its own
 * `?? 'value'`, so every reader agrees on what absent means.
 *
 * Fields whose absence is worked out from other fields (the band's alignment
 * follows the header) have no row: their readers say how.
 */
import type { PortalDesign } from './schema'

type Layout = PortalDesign['layout']
type Shape = PortalDesign['shape']
type Fonts = PortalDesign['brand']['fonts']
type Logo = PortalDesign['brand']['logo']

type Rows<T> = { [K in keyof T]?: NonNullable<T[K]> }

export const DESIGN_DEFAULTS = {
  layout: {
    menuAlign: 'start',
    navText: 'muted',
    blend: 'linear',
    bandShape: 'full',
    bandHeight: 'roomy',
    bandColour: 'accent',
    fadeFrom: 'top',
    bandGlow: 'none',
    headerOnBand: false,
    status: 'colour',
    tint: 'neutral',
    imagePlace: 'side',
    imageFocus: 'centre',
    imagePhone: 'show',
    pageTitles: 'plain',
    bandArt: 'none',
  },
  shape: {
    buttons: 'match',
    action: 'buttons',
    fill: 'accent',
    hover: 'none',
  },
  fonts: {
    scale: 'standard',
    tracking: 'normal',
    headlineCase: 'sentence',
    labelCase: 'sentence',
    headlineColour: 'ink',
  },
  logo: {
    height: 32,
    oneInk: false,
  },
} as const satisfies {
  layout: Rows<Layout>
  shape: Rows<Shape>
  fonts: Rows<Fonts>
  logo: Rows<Logo>
}

type Defaults = typeof DESIGN_DEFAULTS

/** A layout field as the design draws it: its own value, or its default when left out. */
export function layoutValue<K extends keyof Defaults['layout']>(
  layout: Partial<Pick<Layout, K>>,
  key: K
): NonNullable<Layout[K]> {
  return (layout[key] ?? DESIGN_DEFAULTS.layout[key]) as NonNullable<Layout[K]>
}

/** A shape field as the design draws it: its own value, or its default when left out. */
export function shapeValue<K extends keyof Defaults['shape']>(
  shape: Partial<Pick<Shape, K>>,
  key: K
): NonNullable<Shape[K]> {
  return (shape[key] ?? DESIGN_DEFAULTS.shape[key]) as NonNullable<Shape[K]>
}

/** A type setting as the design draws it: its own value, or its default when left out. */
export function fontValue<K extends keyof Defaults['fonts']>(
  fonts: Partial<Pick<Fonts, K>>,
  key: K
): NonNullable<Fonts[K]> {
  return (fonts[key] ?? DESIGN_DEFAULTS.fonts[key]) as NonNullable<Fonts[K]>
}

/** A logo setting as the design draws it: its own value, or its default when left out. */
export function logoValue<K extends keyof Defaults['logo']>(
  logo: Partial<Pick<Logo, K>>,
  key: K
): NonNullable<Logo[K]> {
  return (logo[key] ?? DESIGN_DEFAULTS.logo[key]) as NonNullable<Logo[K]>
}
