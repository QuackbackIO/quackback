/**
 * What the element finder looks for and the closed choices it observes.
 * Shared by the finder, box snapping and the measuring tools built on them.
 */

/** Elements the finder boxes, in the order its answer lists them. */
export const BOX_KINDS = [
  'logo',
  'nav_row',
  'headline',
  'subtitle',
  'primary_button',
  'secondary_button',
  'link',
  'card',
  'input_field',
  'hero',
  'header',
  'product_screenshot',
  'section_heading',
] as const
export type BoxKind = (typeof BOX_KINDS)[number]

/** What sits directly behind the headline. */
export const BEHIND = [
  'plain',
  'tinted',
  'solid_colour',
  'gradient',
  'photo',
  'illustration',
] as const
export type Behind = (typeof BEHIND)[number]

/** How the header menu items look. */
export const NAV_STYLE = ['plain', 'underline', 'pills', 'tabs', 'not_visible'] as const
export type NavStyle = (typeof NAV_STYLE)[number]

export const TEXT_CASE = ['normal', 'upper'] as const
export type TextCase = (typeof TEXT_CASE)[number]

/** The letters of a text: without serifs, with serifs, or all one width (code). */
export const TYPE_KIND = ['sans', 'serif', 'mono', 'not_visible'] as const
export type TypeKindRead = (typeof TYPE_KIND)[number]

export const LOGO_KIND = ['icon', 'wordmark', 'icon_and_name', 'not_visible'] as const
export type LogoKind = (typeof LOGO_KIND)[number]

/** A box in image pixels: left, top, right, bottom (right and bottom exclusive). */
export type Box = [number, number, number, number]
