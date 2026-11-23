/**
 * Whether an SVG logo shows on a surface, by the paints its markup names,
 * and the logo redrawn in a colour that does when it is drawn in one.
 */
import { luminance, sameColour } from '@/lib/shared/theme/colour-setters'
import { colourOver } from './browser/measure-read'

/** Below this contrast with the page, a logo's paint does not show (white on white). */
const LOGO_SHOWS = 1.6
/** A fill or stroke and its value: a colour function, a hex, or a word (a colour's name, or `none`). */
const PAINT =
  /\b(fill|stroke)(\s*[=:]\s*["']?\s*)((?:rgba?|hsla?|oklch|oklab)\([^)]*\)|#[\da-f]{6}\b|#[\da-f]{3}\b|[a-z]+\b(?!\())/gi
/** The colours a logo is drawn in by name: the basic ones, which markup written by hand uses. */
const NAMED_PAINTS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  maroon: '#800000',
  purple: '#800080',
  teal: '#008080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
}

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** The colour a paint draws in, or undefined for one that draws none (`none`, a word that is no colour). */
const hexOf = (paint: string) =>
  /^[a-z]+$/i.test(paint)
    ? NAMED_PAINTS[paint.toLowerCase()]
    : colourOver(
        /^#[\da-f]{3}$/i.test(paint) ? `#${[...paint.slice(1)].map((c) => c + c).join('')}` : paint
      )

/** The colours an SVG logo's markup paints in; shapes with no paint of their own draw black. */
export function paintsOf(svg: string): string[] {
  const paints = [...svg.matchAll(PAINT)]
    .map((m) => hexOf(m[3]!))
    .filter((hex) => hex !== undefined)
  return paints.length > 0 ? paints : ['#000000']
}

/** Whether any paint an SVG logo's markup names shows on `background`. */
export function paintsShowOn(svg: string, background: string): boolean {
  return paintsOf(svg).some((hex) => contrast(hex, background) >= LOGO_SHOWS)
}

/** An ink that draws this much of a logo is one of its main inks. */
const MAIN_INK_SHARE = 0.2

/**
 * The inks the reader counted for an SVG logo, when they agree with its
 * markup: every main ink is a colour the markup paints in. A logo whose
 * colours come from the page's stylesheet can draw differently on its own
 * (all black, say) than it did on the page, and inks that its markup does
 * not name say nothing about it: the markup's paints decide then.
 */
export function inksOfMarkup<Ink extends { color: string; share: number }>(
  inks: readonly Ink[] | undefined,
  svg: string
): readonly Ink[] | undefined {
  if (!inks) return undefined
  const paints = paintsOf(svg)
  const named = (ink: Ink) => paints.some((paint) => sameColour(paint, ink.color))
  return inks.filter((ink) => ink.share >= MAIN_INK_SHARE).every(named) ? inks : undefined
}

/**
 * An SVG logo as it will show on `background`. A logo drawn for a dark hero
 * is often white: one drawn in a single colour is redrawn in the text colour;
 * one of several colours that would not show is left out (null).
 */
export function legibleLogo(svg: string, background: string, ink: string): string | null {
  const paints = [...svg.matchAll(PAINT)]
    .map((m) => hexOf(m[3]!))
    .filter((hex) => hex !== undefined)
  // Shapes with no paint of their own are drawn black.
  const drawn = paints.length > 0 ? paints : ['#000000']
  if (drawn.some((hex) => contrast(hex, background) >= LOGO_SHOWS)) return svg
  if (new Set(drawn).size > 1) return null
  if (paints.length > 0)
    return svg.replace(PAINT, (whole: string, name: string, gap: string, value: string) =>
      hexOf(value) === undefined ? whole : `${name}${gap}${ink}`
    )
  // No paint anywhere: the root's fill is what every shape draws in. One
  // fill only, since a second attribute of the same name is not valid markup.
  return svg.replace(/<svg\b[^>]*>/i, (root) =>
    /\sfill\s*=/i.test(root)
      ? root.replace(/(\sfill\s*=\s*)(?:"[^"]*"|'[^']*')/i, `$1"${ink}"`)
      : root.replace(/<svg\b/i, `<svg fill="${ink}"`)
  )
}
