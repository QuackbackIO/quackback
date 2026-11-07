/**
 * A screenshot taken under a pop-up's dark layer, lifted back before its
 * colours are read. The layer mixes every pixel of the page toward one dark
 * colour by one amount (c' = c (1 - a) + g a), so a white page reads as a
 * mid grey and a navy header as a darker, duller navy. Where the finder saw
 * the layer and the page reads as a neutral mid grey (a white page under
 * it), the amount comes from the page (white under the layer) and the
 * layer's own colour from the darkest ink (black text under it), and every
 * pixel outside the pop-up's bright panel is mixed back.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { chromaOf } from './colours'
import type { Image } from './png'
import { mapColours, surfaceMap } from './surfaces'

/**
 * OKLab lightness of a white page under a dark layer (X0's veiled captures:
 * 0.56 to 0.75): lighter is no layer, darker could be a charcoal dark site.
 */
const VEILED = { min: 0.45, max: 0.86 }
/** A page under a layer is grey: a coloured page cannot be told from a lighter one. */
const GREY = 0.025
/** A colour covering at least this share of the page outside the pop-up counts as a page. */
const PAGE_SHARE = 0.08
/** The layer's own colour is at most this share of the veiled page's level. */
const MAX_OFFSET = 0.2

export interface Veil {
  /** What one unit of the page's colour still shows through (1 - a). */
  keep: number
  /** The layer's added level per channel (g a), 0 to 255. */
  offset: number
  /** The pop-up's bright panel, left as it is: [x0, y0, x1, y1]. */
  panel: [number, number, number, number] | null
}

const lum = (d: Uint8Array, o: number) => 0.2126 * d[o]! + 0.7152 * d[o + 1]! + 0.0722 * d[o + 2]!

/** The pop-up: where nearly all the near-white pixels are (they are its, the page's are veiled). */
function brightPanel(img: Image): Veil['panel'] {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < img.width * img.height; i++)
    if (lum(img.data, i * 4) > 225) {
      xs.push(i % img.width)
      ys.push(Math.floor(i / img.width))
    }
  if (xs.length < img.width * img.height * 0.003) return null
  const at = (list: number[], share: number) =>
    list.sort((a, b) => a - b)[Math.floor((list.length - 1) * share)]!
  return [at(xs, 0.01), at(ys, 0.01), at(xs, 0.99) + 1, at(ys, 0.99) + 1]
}

/** The layer over a screenshot, or null where its page does not read as a white page under one. */
export function veilOf(img: Image): Veil | null {
  const size = Math.max(4, Math.round((8 * img.width) / 1440))
  const map = surfaceMap(img, null, size)
  const panel = brightPanel(img)
  const inPanel = (x: number, y: number) =>
    !!panel && x >= panel[0] && x < panel[2] && y >= panel[1] && y < panel[3]
  const tileInPanel = (t: number) =>
    inPanel(
      map.box[0] + (t % map.cols) * size + size / 2,
      map.box[1] + Math.floor(t / map.cols) * size + size / 2
    )
  const colours = mapColours(
    map,
    (t, kind) => kind !== 'photo' && kind !== 'gradient' && !tileInPanel(t)
  ).colours.filter((c) => c.share >= PAGE_SHARE)
  // The page under the layer: the lightest large grey; a white one outside the pop-up means no layer.
  const page = colours.filter((c) => chromaOf(c.lab) < GREY).sort((a, b) => b.lab[0] - a.lab[0])[0]
  if (!page || page.lab[0] < VEILED.min || page.lab[0] > VEILED.max) return null
  if (colours.some((c) => c.lab[0] > VEILED.max)) return null
  const level = (page.rgb[0] + page.rgb[1] + page.rgb[2]) / 3
  // The darkest ink outside the pop-up: black text under the layer shows the layer's own level.
  const hist = new Uint32Array(256)
  let n = 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (inPanel(x, y)) continue
      const o = (y * img.width + x) * 4
      hist[Math.min(img.data[o]!, img.data[o + 1]!, img.data[o + 2]!)]!++
      n++
    }
  let darkest = 0
  for (let v = 0, seen = 0; v < 256; v++) {
    seen += hist[v]!
    if (seen >= n * 0.002) {
      darkest = v
      break
    }
  }
  const offset = Math.min(darkest, level * MAX_OFFSET)
  return { keep: (level - offset) / 255, offset, panel }
}

/** The screenshot as it was before the layer, outside the pop-up; the same image when no layer reads. */
export function undimmed(img: Image): Image {
  const veil = veilOf(img)
  return veil ? lift(img, veil) : img
}

/** An image lifted from a layer read elsewhere (the same screenshot at another resolution). */
export function lift(img: Image, { keep, offset, panel }: Veil): Image {
  const data = new Uint8Array(img.data)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (panel && x >= panel[0] && x < panel[2] && y >= panel[1] && y < panel[3]) continue
      const o = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++)
        data[o + c] = Math.max(0, Math.min(255, Math.round((img.data[o + c]! - offset) / keep)))
    }
  return { width: img.width, height: img.height, data }
}
