/**
 * The buttons' colour evidence on one screenshot: the finder's main button
 * (its fill, unless it is an inverted, frosted or outline one), filled
 * buttons in the header, and a second button's fill or label. Each sighting
 * is recorded through `add`; the boxes taken by buttons are given back so
 * badges are not looked for there, with the main button the site's buttons
 * are filled like.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { RGB } from './color'
import { chromaOf, clampBox, fillAndInk, labDist, type Swatch } from './colours'
import type { Box } from './kinds'
import type { Image } from './png'
import type { MainButton, ShotInput, Source } from './roles-evidence'
import { tileIn } from './roles-page'
import { chromatic } from './roles-places'
import { DARK_PAGE, isLightNeutral, NEUTRAL } from './roles-tones'
import { solidShapes } from './shapes'
import { mapColours, surfaceMap } from './surfaces'

/**
 * A grey main button this light standing on a photo is a translucent chip over
 * the picture (its grey is the photo's, seen through it), read like a light
 * button on a photo: not the site's button colour.
 */
const FROSTED = 0.7

export const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
export const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1])

/** Without a header box, the strip reaches this far below the menu and logo (CSS px), and no further than this. */
const HEADER_FOOT = 12
const HEADER_MOST = 140

/**
 * Where the header's buttons are looked for: the header's rows across the
 * page's whole width, so a header boxed short of its right edge does not
 * leave a coloured button there out; without a header box, the rows down to
 * the foot of the menu or logo.
 */
function headerStrip(img: Image, boxes: ShotInput['boxes'], u: number): Box | null {
  const header = boxes.header ?? null
  if (header) return [0, header[1], img.width, header[3]]
  const feet = [boxes.nav_row, boxes.logo].flatMap((b) => (b ? [b[3]] : []))
  if (!feet.length) return null
  const foot = Math.min(Math.max(...feet) + HEADER_FOOT * u, HEADER_MOST * u, img.height)
  return [0, 0, img.width, Math.round(foot)]
}

/** The colour around a box (a ring a few pixels outside it): what it sits on. */
function surround(img: Image, b: Box, gap: number): Swatch | null {
  const size = Math.max(4, Math.round(gap))
  const ring = clampBox([b[0] - size * 3, b[1] - size * 3, b[2] + size * 3, b[3] + size * 3], img)
  const map = surfaceMap(img, ring, size)
  const pal = mapColours(map, (t) => !tileIn(map, t, b))
  if (pal.photo >= 0.35) return null
  return pal.colours[0] ?? null
}

type Add = (s: { rgb: RGB; lab: RGB }, source: Source, share?: number) => void

/** The buttons' sightings on one screenshot, the boxes they take, and the main button. */
export function buttonEvidence(
  img: Image,
  boxes: ShotInput['boxes'],
  page: Swatch | null,
  u: number,
  add: Add
): { mainButton: MainButton | null; taken: Box[] } {
  // Buttons: the finder's main button, filled buttons in the header, a second button.
  const taken: Box[] = []
  let primary: MainButton | null = null
  const pb = boxes.primary_button ?? null
  if (pb) {
    const r = fillAndInk(img, pb)
    if (r.fill) {
      const around = surround(img, pb, 4 * u)
      // On a dark page a light button standing on the page is the site's own fill, not an inverted one.
      const onDarkPage =
        !!page && !!around && page.lab[0] < DARK_PAGE && labDist(around.lab, page.lab) < 0.06
      // A pale grey chip on a photo is frosted glass over the picture, not a fill of the site's.
      const frosted = !around && r.fill.lab[0] > FROSTED && chromaOf(r.fill.lab) < NEUTRAL
      const inverted =
        frosted ||
        (isLightNeutral(r.fill) &&
          !onDarkPage &&
          (!around || around.lab[0] < 0.6 || labDist(around.lab, r.fill.lab) > 0.25))
      primary = {
        hex: r.fill.hex,
        rgb: r.fill.rgb,
        ink: r.ink?.hex ?? null,
        source: 'button',
        inverted,
      }
      // A light button on a page of its own colour is an outline or text button, not a fill.
      const outline = around && labDist(around.lab, r.fill.lab) < 0.03
      if (outline) primary = null
      else if (!inverted) add(r.fill, 'button')
      taken.push(pb)
    }
  }
  const headerButtons: { box: Box; fill: Swatch; ink: Swatch | null }[] = []
  const strip = headerStrip(img, boxes, u)
  if (strip) {
    for (const s of solidShapes(img, strip, {
      minHeight: 22 * u,
      maxHeight: 64 * u,
      minAspect: 1.4,
      maxAspect: 8,
    })) {
      if (boxes.logo && overlap(s.box, boxes.logo) > 0.3 * area(s.box)) continue
      if (boxes.input_field && overlap(s.box, boxes.input_field) > 0.3 * area(s.box)) continue
      if (boxes.nav_row && overlap(s.box, boxes.nav_row) > 0.3 * area(s.box)) continue
      if (page && labDist(s.fill.lab, page.lab) < 0.04) continue
      // A pale grey shape in a light header is a search field or a menu pill, not a call to action.
      if (isLightNeutral(s.fill) && !(page && page.lab[0] < DARK_PAGE)) continue
      headerButtons.push(s)
      taken.push(s.box)
      add(s.fill, 'header_button')
    }
  }
  const sb = boxes.secondary_button ?? null
  if (sb) {
    const r = fillAndInk(img, sb)
    const around = surround(img, sb, 4 * u)
    if (r.fill && around && labDist(around.lab, r.fill.lab) > 0.04 && !isLightNeutral(r.fill))
      add(r.fill, 'second_button')
    else if (r.ink && chromatic(r.ink.lab)) add(r.ink, 'second_button_text')
    taken.push(sb)
  }
  let mainButton: MainButton | null = primary && !primary.inverted ? primary : null
  if (!mainButton && headerButtons.length) {
    const b = headerButtons.sort((x, y) => y.box[2] - x.box[2])[0]!
    mainButton = {
      hex: b.fill.hex,
      rgb: b.fill.rgb,
      ink: b.ink?.hex ?? null,
      source: 'header_button',
      inverted: false,
    }
  }
  if (!mainButton && primary) mainButton = primary

  return { mainButton, taken }
}
