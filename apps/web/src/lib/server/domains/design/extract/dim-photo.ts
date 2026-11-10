/**
 * A dark photo hero is not a pop-up's dimming. A pop-up's dark layer darkens
 * the whole screen, to its edges (often around a lighter box in the middle);
 * a photo hero is a bounded picture, and the page outside it keeps its own
 * light colour out to the screen's edges. Read when the finder says a
 * screenshot is dimmed but its pixels show no layer: a photo found in the
 * hero, with the page's light colour reaching both edges on rows outside it,
 * is the page, not a layer.
 *
 * Pure: no app imports, so the offline harness can load it.
 */
import { planHeroPhoto } from './hero-photo'
import type { Behind, Box, BoxKind } from './kinds'
import type { Image } from './png'

/** The page's own light: a dimmed white page measures under 0.25 (a layer at half its light). */
const LIGHT = 0.45
/** The edge strips read, as a share of the width. */
const EDGE = 0.015
/** Rows outside the photo with light at both edges, as a share of the screen: a full-width banner is under it. */
const PAGE_ROWS = 0.12

const linear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** The mean luminance of a row's strip of columns. */
function stripLight(img: Image, y: number, x0: number, x1: number): number {
  let sum = 0
  for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * 4
    sum +=
      0.2126 * linear(img.data[i]!) +
      0.7152 * linear(img.data[i + 1]!) +
      0.0722 * linear(img.data[i + 2]!)
  }
  return sum / Math.max(1, x1 - x0)
}

/** Whether a screenshot read as dimmed is a photo hero on a light page, not a pop-up's layer. */
export function photoNotVeil(
  img: Image,
  boxes: Partial<Record<BoxKind, Box | null>>,
  behind: Behind
): boolean {
  const plan = planHeroPhoto({ img, boxes, behind })
  if (!plan) return false
  const edge = Math.max(2, Math.round(img.width * EDGE))
  let rows = 0
  for (let y = 0; y < img.height; y++) {
    if (y >= plan.region[1] && y < plan.region[3]) continue
    if (
      stripLight(img, y, 0, edge) > LIGHT &&
      stripLight(img, y, img.width - edge, img.width) > LIGHT
    )
      rows++
  }
  return rows / img.height >= PAGE_ROWS
}
