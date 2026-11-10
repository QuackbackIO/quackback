/**
 * The hero's layout, measured from the element finder's boxes rather than
 * asked of a model: where its words sit (left or centred), how much room the
 * band gives them (compact, roomy, tall), and where a picture sits beside
 * them (beside, along the bottom, behind).
 *
 * Alignment reads the hero's stack (headline, subtitle, the buttons' row):
 * left-aligned words share a left edge, centred words share a centre near the
 * page's. Height is the room the band leaves around its words, as a share of
 * the viewport. Pure, so the offline harness can load it.
 */
import type { Box, BoxKind } from '../extract/kinds'

export interface HeroLayoutInput {
  /** The screenshot's width and height, in the boxes' pixels. */
  width: number
  height: number
  boxes: Partial<Record<BoxKind, Box | null>>
}

export interface HeroLayout {
  align: 'left' | 'centre' | null
  height: 'compact' | 'roomy' | 'tall' | null
  /** Where a picture sits beside the words; null when the hero shows none. */
  picture: 'side' | 'edge' | 'cover' | null
  why: { align?: string; height?: string; picture?: string }
}

const mid = (b: Box) => (b[0] + b[2]) / 2
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)

/** The viewport the screenshot shows: its height, or 16:10 of its width for a whole-page capture. */
const viewport = (width: number, height: number) => Math.min(height, Math.round(width * 0.75))

/** The hero's words: the headline, the subtitle, and the buttons' row (both buttons as one). */
function stack(input: HeroLayoutInput): Box[] {
  const b = input.boxes
  const headline = b.headline
  if (!headline) return []
  const top = b.header ? b.header[3] : 0
  const below = (box: Box | null | undefined): box is Box =>
    !!box && box[1] >= top - 2 && box[1] >= headline[1] - 4 && box[1] - headline[3] < 260
  const out: Box[] = [headline]
  if (below(b.subtitle)) out.push(b.subtitle)
  const buttons = [b.primary_button, b.secondary_button].filter(below)
  if (buttons.length) {
    // Two buttons side by side are one row: its extent, not the first button's.
    const row =
      buttons.length === 2 && Math.abs(buttons[0]![1] - buttons[1]![1]) < 12
        ? ([
            Math.min(buttons[0]![0], buttons[1]![0]),
            Math.min(buttons[0]![1], buttons[1]![1]),
            Math.max(buttons[0]![2], buttons[1]![2]),
            Math.max(buttons[0]![3], buttons[1]![3]),
          ] as Box)
        : buttons[0]!
    out.push(row)
  }
  return out
}

function alignOf(
  input: HeroLayoutInput,
  words: Box[]
): Pick<HeroLayout, 'align'> & { why?: string } {
  if (!words.length) return { align: null }
  const page = input.width / 2
  const near = (x: number) => Math.abs(x - page) < 0.06 * input.width
  if (words.length === 1) {
    const [w] = words
    const centred = near(mid(w!)) && w![0] > 0.12 * input.width
    return {
      align: centred ? 'centre' : 'left',
      why: centred ? 'the headline sits centred on the page' : 'the headline starts at the left',
    }
  }
  const lefts = spread(words.map((w) => w[0]))
  const centres = spread(words.map(mid))
  const meanCentre = words.reduce((s, w) => s + mid(w), 0) / words.length
  const centred = centres < lefts && near(meanCentre) && near(mid(words[0]!))
  return {
    align: centred ? 'centre' : 'left',
    why: centred
      ? 'the headline, subtitle and buttons share a centre on the page'
      : 'the headline, subtitle and buttons share a left edge',
  }
}

function heightOf(
  input: HeroLayoutInput,
  words: Box[]
): Pick<HeroLayout, 'height'> & { why?: string } {
  const hero = input.boxes.hero
  if (!hero || !words.length) return { height: null }
  const view = viewport(input.width, input.height)
  const top = Math.max(hero[1], input.boxes.header?.[3] ?? 0)
  const bottom = Math.min(hero[3], view)
  const wordsTop = Math.min(...words.map((w) => w[1]))
  const wordsBottom = Math.max(...words.map((w) => w[3]))
  const room = (bottom - top - (wordsBottom - wordsTop)) / view
  if (bottom - top <= 0) return { height: null }
  const height = room < 0.15 ? 'compact' : room > 0.45 ? 'tall' : 'roomy'
  return {
    height,
    why: `the hero leaves ${Math.round(Math.max(0, room) * 100)}% of the screen around its words`,
  }
}

function pictureOf(
  input: HeroLayoutInput,
  words: Box[]
): Pick<HeroLayout, 'picture'> & { why?: string } {
  const pic = input.boxes.product_screenshot
  if (!pic || !words.length) return { picture: null }
  const view = viewport(input.width, input.height)
  if (pic[1] >= view) return { picture: null }
  const left = Math.min(...words.map((w) => w[0]))
  const right = Math.max(...words.map((w) => w[2]))
  const bottom = Math.max(...words.map((w) => w[3]))
  const overlapX = Math.max(0, Math.min(right, pic[2]) - Math.max(left, pic[0]))
  const beside = overlapX < 0.25 * (pic[2] - pic[0])
  if (beside) return { picture: 'side', why: 'a picture sits beside the words' }
  if (pic[1] >= bottom - 8) return { picture: 'edge', why: 'a picture sits below the words' }
  return { picture: 'cover', why: 'a picture sits behind the words' }
}

/** The hero's alignment, height and picture place, measured; null where a box is missing. */
export function heroLayout(input: HeroLayoutInput): HeroLayout {
  const words = stack(input)
  const a = alignOf(input, words)
  const h = heightOf(input, words)
  const p = pictureOf(input, words)
  return {
    align: a.align,
    height: h.height,
    picture: p.picture,
    why: { align: a.why, height: h.why, picture: p.why },
  }
}
