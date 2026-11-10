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
import type { BackgroundFill, BackgroundKind } from './page-background'
import type { PortalDesign } from './schema'

type Layout = PortalDesign['layout']
type Shape = PortalDesign['shape']
type Fonts = PortalDesign['brand']['fonts']
type Logo = PortalDesign['brand']['logo']
type BlockLook = NonNullable<PortalDesign['pages']['home']['blocks'][number]['look']>
type Fill<K extends BackgroundKind> = Extract<BackgroundFill, { kind: K }>

type Rows<T> = { [K in keyof T]?: NonNullable<T[K]> }

export const DESIGN_DEFAULTS = {
  layout: {
    menuAlign: 'start',
    navText: 'muted',
    blend: 'linear',
    heroShape: 'full',
    heroHeight: 'roomy',
    heroColour: 'accent',
    fadeFrom: 'top',
    heroGlow: 'none',
    headerOnHero: false,
    status: 'colour',
    tint: 'neutral',
    imagePlace: 'side',
    imageFocus: 'centre',
    imagePhone: 'show',
    pageTitles: 'plain',
    heroArt: 'none',
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
  /** A Home block's own look; its tone and alignment follow the site's when left out. */
  blockLook: {
    colour: 'accent',
  },
  /**
   * A page background's settings, by its kind. Written out in page-background.ts
   * too (BACKGROUND_FILL_DEFAULTS, held equal by a test), which every portal
   * page loads and which must not load this table.
   */
  backgroundFill: {
    tint: { strength: 'soft' },
    gradient: { shape: 'linear', direction: 'down', centre: 'top', strength: 'faint' },
    pattern: { colour: 'accent', scale: 'medium', strength: 'faint' },
    image: { fit: 'cover', position: 'centre', strength: 35, scroll: 'scroll' },
  },
} as const satisfies {
  layout: Rows<Layout>
  shape: Rows<Shape>
  fonts: Rows<Fonts>
  logo: Rows<Logo>
  blockLook: Rows<Pick<BlockLook, 'colour'>>
  backgroundFill: { [K in Exclude<BackgroundKind, 'solid'>]: Rows<Omit<Fill<K>, 'kind' | 'dark'>> }
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

/** A Home block's look setting as drawn: its own value, or its default when left out. */
export function blockLookValue<K extends keyof Defaults['blockLook']>(
  look: Partial<Pick<BlockLook, K>> | undefined,
  key: K
): NonNullable<BlockLook[K]> {
  return (look?.[key] ?? DESIGN_DEFAULTS.blockLook[key]) as NonNullable<BlockLook[K]>
}

type FillDefaults = Defaults['backgroundFill']

/** A page background's setting as drawn: its own value, or its kind's default when left out. */
export function fillValue<
  F extends Fill<keyof FillDefaults>,
  K extends keyof FillDefaults[F['kind']] & keyof Fill<F['kind']>,
>(fill: F, key: K): NonNullable<Fill<F['kind']>[K]> {
  const rows = DESIGN_DEFAULTS.backgroundFill[fill.kind as keyof FillDefaults] as Record<
    PropertyKey,
    unknown
  >
  return ((fill as Record<PropertyKey, unknown>)[key] ?? rows[key]) as NonNullable<
    Fill<F['kind']>[K]
  >
}
