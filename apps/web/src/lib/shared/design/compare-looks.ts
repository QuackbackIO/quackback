/**
 * Compare looks: the brand's three looks side by side or one at a time, of
 * which one is taken into the draft. A look is taken whole (its colours,
 * fonts, shape, layout and exact values, as the match measured them), while
 * the draft keeps its own pages, menu, words and logo, so a headline or a
 * menu edited since the match stays.
 */
import { lookOf, withLook } from './looks'
import type { LookVariant, LookVariantId } from './look-variants'
import type { PortalDesign } from './schema'

export const LOOK_ORDER: readonly LookVariantId[] = ['matched', 'soft', 'vivid']

export const LOOK_NAMES: Record<LookVariantId, string> = {
  matched: 'Matched',
  soft: 'Soft',
  vivid: 'Vivid',
}

export const LOOK_HINTS: Record<LookVariantId, string> = {
  matched: 'Measured from your site.',
  soft: 'Tinted hero, more space, round corners.',
  vivid: 'Brand colour hero, big headlines.',
}

/** The widths a look is drawn at before it is scaled: the chooser's desktop and phone. */
export const LOOK_WIDTHS = { desktop: 1024, phone: 390 } as const
export type LookDevice = keyof typeof LOOK_WIDTHS

/** How the looks are shown: all three at once, or one large. */
export type LooksView = 'side' | 'one'

/** Below this window width only one look fits: Side by side is not offered. */
export const SIDE_BY_SIDE_MIN = 960

/** The draft with a look taken: the look's treatment, the draft's own pages, menu and words. */
export function withVariant(draft: PortalDesign, variant: LookVariant): PortalDesign {
  return withLook(draft, lookOf(variant.design), { itsColours: true })
}

/** The step's name in undo, and what the toast says once it is taken. */
export const lookStep = (id: LookVariantId) => `${LOOK_NAMES[id]} look`
export const lookApplied = (id: LookVariantId) => `${LOOK_NAMES[id]} look applied`

/** What Ask AI says after a look is taken from its reply. */
export const switchedReply = (id: LookVariantId) =>
  `Switched to ${LOOK_NAMES[id]}. Kept your headline and menu.`

/** The view the chooser shows: one at a time in a narrow window, whatever was asked. */
export function shownView(asked: LooksView, viewport: number): LooksView {
  return viewport < SIDE_BY_SIDE_MIN ? 'one' : asked
}

/** How a look is scaled one at a time: to fit, or at a set share of its true width. */
export type LookZoom = 'fit' | 0.5 | 0.75 | 1

/**
 * The scale and laid-out height of a look's page in a box of a size: side by
 * side, the page always fits the box's width, never above its true size; one
 * at a time, the zoom asked for, as the canvas scales.
 */
export function lookFrameSize(
  box: { width: number; height: number },
  width: number,
  view: LooksView,
  zoom: LookZoom
): { scale: number; height: number } {
  const fit = view === 'side' || zoom === 'fit'
  const scale = fit ? (box.width > 0 ? Math.min(1, box.width / width) : 1) : zoom
  return { scale, height: box.height > 0 ? box.height / scale : 800 }
}
