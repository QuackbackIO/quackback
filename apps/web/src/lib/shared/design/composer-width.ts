/**
 * How wide Home's composer is when it sits in the hero (pages.home.composer
 * `band`): a few steps, each a measure the composer keeps to within the
 * hero's words, so beside a side image, on a panel or on one half of a split
 * it never runs past them. Centred words keep it centred, so it grows and
 * shrinks on both sides. Phones always give it the full width.
 *
 * Left out, it draws as it always has: a measure beside an image or when
 * centred, else the words' full width.
 */
import type { PortalDesign } from './schema'
import { layoutValue } from './defaults'

/**
 * The steps, narrowest first. DESIGN_OPTIONS reads them from here, so the
 * portal's hero can size its composer without loading every design option.
 */
export const COMPOSER_WIDTHS = ['narrow', 'medium', 'wide', 'full'] as const

export type ComposerWidth = (typeof COMPOSER_WIDTHS)[number]

/** Each step's measure; the full step is the words' own width. */
const MEASURE_REM: Record<ComposerWidth, number | null> = {
  narrow: 24,
  medium: 32,
  wide: 40,
  full: null,
}

/** Each step's class, written out whole so the stylesheet keeps it. From sm up; phones run full. */
const STEP_CLASS: Record<ComposerWidth, string> = {
  narrow: 'max-w-none sm:max-w-[24rem]',
  medium: 'max-w-none sm:max-w-[32rem]',
  wide: 'max-w-none sm:max-w-[40rem]',
  full: 'max-w-none',
}

/** What the hero around the composer is: an image beside its words, its words centred. */
export interface ComposerSetting {
  side: boolean
  centred: boolean
}

/** The composer's measure as a class: a stored step's, or the one it always had when left out. */
export function composerWidthClass(width: ComposerWidth | undefined, side: boolean): string {
  if (width) return STEP_CLASS[width]
  return side ? 'max-w-[40rem]' : '[[data-qb-band-align=centre]_&]:max-w-[40rem]'
}

/** The step a composer draws at: its own, or the one it draws as when left out. */
export function drawnComposerWidth(
  width: ComposerWidth | undefined,
  { side, centred }: ComposerSetting
): ComposerWidth {
  return width ?? (side || centred ? 'wide' : 'full')
}

/** Whether a design's hero has an image beside its words, and centres them. */
export function composerSetting(design: PortalDesign): ComposerSetting {
  const { layout } = design
  return {
    side: !!design.brand.bandImage && layoutValue(layout, 'imagePlace') === 'side',
    centred: (layout.bandAlign ?? (layout.header === 'centered' ? 'centre' : 'left')) === 'centre',
  }
}

/** The step a design's composer draws at in the hero. */
export function composerWidthOf(design: PortalDesign): ComposerWidth {
  return drawnComposerWidth(design.pages.home.composerWidth, composerSetting(design))
}

/** Stores a step; one that draws as a width left out would is left out. */
export function writeComposerWidth(draft: PortalDesign, width: ComposerWidth): void {
  if (width === drawnComposerWidth(undefined, composerSetting(draft)))
    delete draft.pages.home.composerWidth
  else draft.pages.home.composerWidth = width
}

/** Each step's width in px, none past the words' width (`room`), with the page's rem. */
export function composerWidthMeasures(
  room: number,
  rem: number
): Array<{ step: ComposerWidth; px: number }> {
  return COMPOSER_WIDTHS.map((step) => {
    const measure = MEASURE_REM[step]
    return { step, px: measure === null ? room : Math.min(measure * rem, room) }
  })
}

/**
 * The step nearest a dragged width. Among steps that draw alike, the one it
 * is at stays, else the narrowest.
 */
export function snapComposerWidth(
  px: number,
  measures: ReadonlyArray<{ step: ComposerWidth; px: number }>,
  current: ComposerWidth
): ComposerWidth {
  const nearest = Math.min(...measures.map((m) => Math.abs(m.px - px)))
  const tied = measures.filter((m) => Math.abs(m.px - px) === nearest)
  return (tied.find((m) => m.step === current) ?? tied[0]!).step
}

/** The next step wider or narrower that draws differently, or null at the end. */
export function stepComposerWidth(
  current: ComposerWidth,
  way: 'wider' | 'narrower',
  measures: ReadonlyArray<{ step: ComposerWidth; px: number }>
): ComposerWidth | null {
  const at = measures.findIndex((m) => m.step === current)
  const now = measures[at]?.px
  if (now === undefined) return null
  const ahead = way === 'wider' ? measures.slice(at + 1) : measures.slice(0, at).reverse()
  return ahead.find((m) => m.px !== now)?.step ?? null
}

/** A key press as the composer reads it. */
export type ComposerKey = Pick<KeyboardEvent, 'key'> &
  Partial<Pick<KeyboardEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>>

/** Shift and Left or Right: a step narrower or wider; anything else is not the composer's. */
export function composerWidthKey(event: ComposerKey): 'wider' | 'narrower' | null {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null
  return event.key === 'ArrowRight' ? 'wider' : event.key === 'ArrowLeft' ? 'narrower' : null
}

/** A step as people read it: "Narrow". */
export const COMPOSER_WIDTH_NAMES: Record<ComposerWidth, string> = {
  narrow: 'Narrow',
  medium: 'Medium',
  wide: 'Wide',
  full: 'Full',
}
