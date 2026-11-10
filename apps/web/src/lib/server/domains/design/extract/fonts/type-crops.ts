/**
 * The text crops the font matcher reads: each text's box cut from its image
 * with a margin, so a worker thread is handed a few hundred kilobytes rather
 * than the whole screenshot, and matching the crop equals matching the page.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Image } from '../png'
import { matchText, type TypeMatch } from './type-match'

/** One text to match: its crop, its box in the crop, its words, and the crop's device scale. */
export interface TypeCrop {
  img: Image
  box: [number, number, number, number]
  text: string
  scale: number
}

export interface TypeCropSet {
  headline: TypeCrop | null
  body: TypeCrop | null
}

export interface TypeMatches {
  headline: TypeMatch | null
  body: TypeMatch | null
}

export const NO_MATCHES: TypeMatches = { headline: null, body: null }

/** The margin kept around a box, in CSS px: well past the matcher's own frame. */
const MARGIN = 24

/** A box's text cut from an image with a margin, or null without a box or words. */
export function cropText(
  img: Image,
  box: readonly number[] | null,
  text: string,
  scale = 1
): TypeCrop | null {
  if (!box || !text.trim()) return null
  const pad = Math.round(MARGIN * scale)
  const x0 = Math.max(0, Math.floor(box[0]!) - pad)
  const y0 = Math.max(0, Math.floor(box[1]!) - pad)
  const x1 = Math.min(img.width, Math.ceil(box[2]!) + pad)
  const y1 = Math.min(img.height, Math.ceil(box[3]!) + pad)
  if (x1 <= x0 || y1 <= y0) return null
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * img.width + x0) * 4
    data.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return {
    img: { width, height, data },
    box: [box[0]! - x0, box[1]! - y0, box[2]! - x0, box[3]! - y0],
    text,
    scale,
  }
}

const matchCrop = (crop: TypeCrop | null, reread: boolean) =>
  crop ? matchText(crop.img, crop.box, crop.text, { scale: crop.scale, reread }) : null

/**
 * Each crop's face, matched in this thread. Only the headline is read again
 * where no face draws it (matchText): text under it that only another reading
 * draws reads too weakly to stand against the headline's face, and takes it
 * instead (11-04: three of four such paragraphs set in a face of their own lost).
 */
export function matchCrops(crops: TypeCropSet): TypeMatches {
  return { headline: matchCrop(crops.headline, true), body: matchCrop(crops.body, false) }
}

/** What the brand match hands the font worker. */
export interface TypeWorkerRequest {
  crops: TypeCropSet
}

/** What the font worker says: loaded, then its answer. */
export type TypeWorkerMessage =
  { type: 'ready' } | { type: 'done'; ok: true; matches: TypeMatches } | { type: 'done'; ok: false }
