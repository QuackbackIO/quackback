/**
 * A mesh of glows on the page's own colour. Beside left-aligned words the
 * brand's colours run into each other across one field, mixed in oklab with
 * a vivid colour between them (blendHue), and the page's colour lies over
 * the field but for one soft opening: the hues never lie over each other as
 * separate layers, which a browser would blend in sRGB, greying where they
 * meet. The opening is an ellipse sized by the band's own box, so it fades to
 * nothing inside the band at any width or height rather than running off its
 * side as a slab or stopping at a hard edge, and the page's colour lies under
 * the words to past the subtitle's measure. Centred words sit in one bloom: wide glows from the band's corners
 * around an ellipse of the page's colour under the words. A glow is never deeper than the
 * headline on it allows, so the words read wherever a long one reaches. On
 * phones, where the words cross the whole band, the glows are veiled further,
 * until the subtitle reads on them too; they are part of what the words sit
 * on, so the colours worked out for the words afterwards (a tuned subtitle,
 * the accent phrase) read on them as well.
 * Pure: the server's resolver and the builder's preview draw the same CSS.
 */
import { blendHue, liftToward } from './color'
import { contrastRatio } from './contrast'

export interface MeshColours {
  page: string
  /** The headline's colour. */
  ink: string
  /** The subtitle's colour. */
  muted: string
  primary: string
  second: string
}

export interface Mesh {
  background: string
  narrow: string
  /** Every colour the mesh can put under a header that shares it. */
  across: string[]
  /** What the words sit on: the page, and on phones the glows they cross. */
  behind: string[]
}

/** Large text, as a headline is, reads at 3:1; the subtitle at 4.5:1. */
const HEADLINE = 3
const SUBTITLE = 4.5

/**
 * The colour as deep as it can be, lifted back toward the page's lightness
 * in steps (keeping its hue and colour, liftToward), while every text keeps
 * its contrast on it (as it has on the page, at most).
 */
export function veiledFor(
  colour: string,
  page: string,
  texts: Array<{ ink: string; target: number }>
): string {
  const reads = (behind: string) =>
    texts.every(
      ({ ink, target }) =>
        contrastRatio(ink, behind) >= Math.min(target, contrastRatio(ink, page) - 0.01)
    )
  for (let share = 100; share > 0; share -= 5) {
    const mixed = liftToward(colour, page, share / 100)
    if (reads(mixed)) return mixed
  }
  return page
}

/**
 * The page's colour over a field but for a soft elliptical opening, where
 * the field shows through fading out to nothing at the ellipse's rim.
 */
function opening(page: string, at: string, size: string): string {
  return `radial-gradient(ellipse ${size} at ${at}, transparent 0%, transparent 18%, color-mix(in oklab, ${page} 50%, transparent) 55%, ${page} 100%)`
}

/** The brand's colours across one field, mixed in oklab, at an angle and between two points along it. */
function colourField(angle: number, colours: string[], from: number, to: number): string {
  const step = (to - from) / (colours.length - 1)
  const stops = colours.map((colour, i) => `${colour} ${Math.round(from + step * i)}%`)
  return `linear-gradient(in oklab ${angle}deg, ${stops.join(', ')})`
}

/**
 * Where the page column starts, as the band lays it out: centred within the
 * band at the page's widest, its padding in.
 */
const COLUMN = 'max(0px, (100% - var(--qb-page-max, 72rem)) / 2) + 1.5rem'

/** The subtitle's measure (max-w-2xl) and how far past it the page's colour fades. */
const MEASURE = '42rem'
const FADE = '10rem'

export function meshBand(c: MeshColours, centred: boolean): Mesh {
  const headline = [{ ink: c.ink, target: HEADLINE }]
  // On phones every word may cross a glow, the headline's text included at 4.5:1.
  const words = [
    { ink: c.ink, target: SUBTITLE },
    { ink: c.muted, target: SUBTITLE },
  ]
  const middle = blendHue(c.primary, c.second, 0.5)
  const [primary, second, mid] = [c.primary, c.second, middle].map((colour) =>
    veiledFor(colour, c.page, headline)
  ) as [string, string, string]
  const background = (
    centred
      ? [
          `radial-gradient(ellipse 42% 58% at 50% 50%, ${c.page} 40%, transparent 100%)`,
          `radial-gradient(circle at 12% 18%, ${primary} 0%, transparent 32%)`,
          `radial-gradient(circle at 90% 22%, ${second} 0%, transparent 34%)`,
          `radial-gradient(circle at 82% 92%, ${mid} 0%, transparent 34%)`,
          `radial-gradient(circle at 16% 90%, ${second} 0%, transparent 30%)`,
        ]
      : [
          `linear-gradient(90deg, ${c.page} calc(${COLUMN} + ${MEASURE}), transparent calc(${COLUMN} + ${MEASURE} + ${FADE}))`,
          // Spanning the opening, the colours run diagonally from the first, through
          // the vivid one between, to the second.
          opening(c.page, '75% 50%', '23% 54%'),
          colourField(120, [primary, mid, second], 60, 84),
        ]
  )
    .concat(c.page)
    .join(', ')
  const [phonePrimary, phoneSecond, phoneMid] = [c.primary, c.second, middle].map((colour) =>
    veiledFor(colour, c.page, words)
  ) as [string, string, string]
  const narrow = [
    opening(c.page, '50% 52%', '48% 44%'),
    colourField(160, [phonePrimary, phoneMid, phoneSecond], 25, 75),
    c.page,
  ].join(', ')
  return {
    background,
    narrow,
    across: [c.page, primary, second, mid],
    behind: [c.page, phonePrimary, phoneSecond, phoneMid],
  }
}
