/**
 * The bundled face a screenshot's text is set in: the text crop measured,
 * its words drawn in each bundled face and weight, the closest kept. Gives
 * the face, its weight, the size and letter-spacing that reproduce the crop,
 * and how closely it fits (word overlap), so a face nothing bundled comes
 * close to is said to be the closest available rather than a match.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Image } from '../png'
import { faceById, type Face, type WeightFit } from './faces'
import { MATCHED_LINES, matchFaces, measure, type Candidate } from './match'
import { woffRenderer, type Renderer } from './woff'

/**
 * Text whose letters are this much narrower (log ratio) than the normal-width
 * faces' is condensed: drawn by this renderer, Oswald and Barlow Condensed
 * read -0.27 to -0.48, normal faces tracked from -0.08 to 0 within 0.11.
 */
export const CONDENSED_BELOW = -0.2

/** Faces of normal width, the yardstick for a text's glyph width. */
const normalWidth = (face: Face) =>
  face.top !== 'mono' && face.sub !== 'condensed' && face.sub !== 'wide'

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)]! : 0
}

/** A face's fit at each weight stage 1 drew, lightest first. */
const fitsOf = (fitted: readonly Candidate[], id: string): WeightFit[] =>
  fitted
    .filter((c) => c.face.id === id)
    .sort((a, b) => a.weight - b.weight)
    .map(({ weight, size, tracking }) => ({ weight, size, tracking }))

/** Below this word overlap no bundled face is close: the match is kept and said to be the closest available. */
export const CLOSE_IOU = 0.7

/** A face as the matcher fitted it: its best weight, size and letter-spacing, and its word overlap. */
export interface FaceOption {
  face: Face
  weight: number
  size: number
  tracking: number
  iou: number
  capRatio: number
  /** Its fit at each weight drawn, lightest first; absent from a match made without them. */
  fits?: WeightFit[]
}

export interface TypeMatch {
  face: Face
  weight: number
  /** The crop's own weight from its stems, any face (the calibrated stem table), unrounded. */
  stem: number
  /** Font size in CSS px that reproduces the crop in this face. */
  size: number
  /** Letter-spacing in em the face needs to match the crop's widths. */
  tracking: number
  /** Word ink overlap of the best drawing, 0 to 1. */
  iou: number
  close: boolean
  /** The crop's tall height (capitals or ascenders) over the matched size: the face's own ratio. */
  capRatio: number
  /** Set in capitals (no x-height step). */
  upper: boolean
  /**
   * The letters' own widths (ink columns, free of letter-spacing) against the
   * normal-width faces drawn at the same height, as a log ratio: about 0 for a
   * normal-width face however it is tracked, under CONDENSED_BELOW for a
   * condensed one. Absent from a match made without it.
   */
  glyphWidth?: number
  /** Letters (not spaces) on the lines the faces were drawn for: the width reading's sample. */
  letters?: number
  /** Those lines' ink width summed, CSS px. */
  widthPx?: number
  /** Their gaps between characters summed, as a fit's letter-spacing spreads over them. */
  letterGaps?: number
  /** The face's fit at each weight drawn, lightest first; absent from a match made without them. */
  fits?: WeightFit[]
  /** The next faces, for a reply that names alternatives. */
  runnersUp: string[]
  /** Every face as fitted, best first (the match itself first), for a choice under the site's category and weights. */
  alternatives: FaceOption[]
  ms: number
}

/**
 * Below this word overlap no face draws a text: its crop held other ink (a
 * photo, an overlay, lines run together), and the ranking under it is noise.
 * On the bench the drawings of real text run from about 0.43 up; those of
 * such crops from 0 to 0.38.
 */
export const UNREAD_IOU = 0.4

/**
 * The other readings of a box no face drew, tried in turn: its lines parted
 * at a higher floor (a photo's edge or close leading bridging two lines into
 * one), its lines holding only the text's first words (a box around the first
 * of a paragraph's lines, with the whole paragraph's words), and both.
 */
const READINGS: ReadonlyArray<{ floor?: number; firstLines?: boolean }> = [
  { floor: 0.08 },
  { firstLines: true },
  { floor: 0.08, firstLines: true },
]

/** What a reading put on its lines, to skip one that reads the box as another did. */
const readAs = (m: ReturnType<typeof measure>) =>
  m.lines.map((l) => `${l.lm.top}:${l.lm.bottom}:${l.text}`).join('|')

/**
 * The face of the text in a box, or null when the box holds no complete
 * line whose words are known (the words come from the element finder).
 * Where no face draws the box as read (UNREAD_IOU), the other readings are
 * tried, and the first a face draws stands, unless `reread` is false.
 */
export function matchText(
  img: Image,
  box: readonly number[] | null,
  text: string,
  opts: { scale?: number; renderer?: Renderer; reread?: boolean } = {}
): TypeMatch | null {
  if (!box || !text.trim()) return null
  const t0 = performance.now()
  const scale = opts.scale ?? 1
  const renderer = opts.renderer ?? woffRenderer()
  const measured = measure(img, [...box], text, scale, Infinity)
  const first = measured.lines.length ? matchMeasured(measured, renderer, scale, t0) : null
  if ((first && first.iou >= UNREAD_IOU) || opts.reread === false) return first
  const tried = new Set([readAs(measured)])
  for (const reading of READINGS) {
    const other = measure(img, [...box], text, scale, Infinity, reading)
    const as = readAs(other)
    if (!other.lines.length || tried.has(as)) continue
    tried.add(as)
    const match = matchMeasured(other, renderer, scale, t0)
    if (match && match.iou >= UNREAD_IOU) return match
  }
  return first
}

function matchMeasured(
  measured: ReturnType<typeof measure>,
  renderer: Renderer,
  scale: number,
  t0: number
): TypeMatch | null {
  const { ranked, fitted } = matchFaces(renderer, measured)
  const top = ranked[0]
  if (!top || !Number.isFinite(top.size) || top.size <= 0) return null
  const iou = top.iou ?? 0
  const tallCss = measured.tm.tall / measured.scale / scale
  // The lines the faces were drawn for (the matcher draws the first three).
  const drawn = measured.lines.slice(0, MATCHED_LINES)
  const alternatives = ranked
    .filter((c) => Number.isFinite(c.size) && c.size > 0)
    .map((c) => ({
      face: faceById(c.face.id) ?? c.face,
      weight: c.weight,
      size: c.size,
      tracking: c.tracking,
      iou: c.iou ?? 0,
      capRatio: tallCss / c.size,
      fits: fitsOf(fitted, c.face.id),
    }))
  return {
    face: faceById(top.face.id) ?? top.face,
    weight: top.weight,
    stem: measured.weightPixel,
    size: top.size,
    tracking: top.tracking,
    iou,
    close: iou >= CLOSE_IOU,
    capRatio: tallCss / top.size,
    fits: fitsOf(fitted, top.face.id),
    upper: measured.upper,
    glyphWidth: median(ranked.filter((c) => normalWidth(c.face)).map((c) => c.eW)),
    letters: drawn.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0),
    widthPx: drawn.reduce((w, l) => w + l.lm.width, 0) / measured.scale / scale,
    letterGaps: drawn.reduce((n, l) => n + Math.max(0, [...l.text].length - 1), 0),
    runnersUp: ranked.slice(1, 4).map((c) => c.face.id),
    alternatives,
    ms: performance.now() - t0,
  }
}

/**
 * The size and letter-spacing a face needs at a weight: its fit at that
 * weight, else the two drawn weights either side interpolated, else null.
 * A face is fitted at the weight it draws best, but the portal may draw it
 * lighter (the stem reads lighter than the fit) or at the nearest weight it
 * loads; a lighter weight's letters are narrower, so the spacing fitted for
 * the heavier one would set them too tight.
 */
export function fitAt(
  option: Pick<FaceOption, 'fits'>,
  weight: number
): { size: number; tracking: number } | null {
  const fits = option.fits ?? []
  const exact = fits.find((f) => f.weight === weight)
  if (exact) return { size: exact.size, tracking: exact.tracking }
  const below = fits.filter((f) => f.weight < weight).at(-1)
  const above = fits.find((f) => f.weight > weight)
  if (!below || !above) return null
  const t = (weight - below.weight) / (above.weight - below.weight)
  return {
    size: below.size + t * (above.size - below.size),
    tracking: below.tracking + t * (above.tracking - below.tracking),
  }
}
