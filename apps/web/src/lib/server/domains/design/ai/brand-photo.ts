/**
 * The hero photo in a brand match: where a site leads with a photo, a crop of
 * it from the customer's own screenshot is proposed as the hero's image,
 * marked as taken from the screenshot so the builder asks for the original.
 *
 * The photo is found and judged at CSS scale (extract/hero-photo.ts), then
 * cut from the sharpest source the builder sent that holds it (the page's top
 * at its own resolution, or a crop of the first screen, else the analysis
 * image), with the site's own words taken out where they sit on it. Two files
 * are stored: the crop, and the photo it was cut from (for cropping again).
 * Too small, blurred or grainy, nothing is stored, and the reply offers to
 * add a photo instead.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Box } from '../extract/kinds'
import { planHeroPhoto, type HeroPhotoPlan } from '../extract/hero-photo'
import {
  cropImage,
  erase,
  photoFocus,
  photoQuality,
  photoShade,
  type PhotoQuality,
  type PhotoShade,
} from '../extract/photo-tools'
import { encodeJpeg } from '../extract/jpeg'
import { downscale, type Image } from '../extract/png'
import type { BrandChange } from './brand-decide'
import { isDimmed, type Shot } from './brand-measure'

/** Stores a photo (JPEG), giving its key, or null when it cannot be stored. */
export type PhotoStore = (jpeg: Uint8Array, name: string) => Promise<string | null>

/** The widest photo stored, px: wider is halved (a retina capture of a wide screen). */
const MAX_STORED = 2880
const QUALITY = 85

export interface BrandPhoto {
  /** The site's hero is photo-led: the reply offers a hero photo either way. */
  led: boolean
  plan: HeroPhotoPlan | null
  quality: PhotoQuality | null
  /** What was stored and measured, when the crop is good enough. */
  placed: {
    key: string
    source: string
    box: { x: number; y: number; w: number; h: number }
    focus: { x: number; y: number }
    shade: PhotoShade | null
    alt: string
  } | null
}

/** The finder's words on what is behind the headline that name something other than a photo. */
const NOT_A_PHOTO = /\b(gradient|plain|blank|panel|illustration|pattern|page background|solid)\b/i

const NONE: BrandPhoto = { led: false, plan: null, quality: null, placed: null }

/** No photo measured (out of time or failed): offered still where the finder saw one. */
export const unmeasuredPhoto = (shot: Shot): BrandPhoto => ({
  ...NONE,
  led:
    shot.found.output.behind_headline === 'photo' &&
    !NOT_A_PHOTO.test(shot.found.output.behind_headline_evidence),
})

/**
 * What the photo shows, from the finder's words on what is behind the
 * headline ("dark brown photo of a hand holding a phone with peaches, darker
 * area behind the headline"): the subject after "photo of", up to the first
 * comma, as a sentence.
 */
export function photoAlt(evidence: string): string {
  const said = evidence.trim()
  const of = said.match(/\b(?:photo(?:graph)?|picture|image)s?\s+of\s+(.+)/i)
  const subject = (of ? of[1]! : said)
    .split(/[,;.]/)[0]!
    // Where the site's words sat is the screenshot's, not the photo's.
    .replace(
      /\s+(?:behind|under|over|beneath)\s+(?:the\s+)?(?:headline|heading|text|words)\b.*$/i,
      ''
    )
    .trim()
  const text = subject ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)}` : ''
  return text.slice(0, 200)
}

const scaled = (b: Box, s: number, at: readonly number[] = [0, 0]): Box => [
  Math.round((b[0] - at[0]!) * s),
  Math.round((b[1] - at[1]!) * s),
  Math.round((b[2] - at[0]!) * s),
  Math.round((b[3] - at[1]!) * s),
]

/** The sharpest image sent that holds the whole photo, and its scale over CSS pixels. */
function sourceFor(shot: Shot, region: Box): { img: Image; scale: number } {
  const options = [shot.strip, shot.hero ?? null]
    .filter((img): img is Image => !!img)
    .map((img) => ({ img, scale: img.width / shot.img.width }))
    .filter(
      ({ img, scale }) =>
        scale >= 1 &&
        img.height >= Math.floor(region[3] * scale) &&
        img.width >= Math.floor(region[2] * scale)
    )
    .sort((a, b) => b.scale - a.scale)
  return options[0] ?? { img: shot.img, scale: 1 }
}

/**
 * The hero photo of the primary screenshot: found, judged and, when good
 * enough and storage is there, cut and stored with what the design needs.
 */
export async function brandPhoto(
  shot: Shot,
  store: PhotoStore | undefined,
  { dimmed = false }: { dimmed?: boolean } = {}
): Promise<BrandPhoto> {
  const output = shot.found.output
  const plan = planHeroPhoto({
    img: shot.img,
    boxes: shot.found.snapped,
    behind: output.behind_headline,
  })
  // Led by a photo: the finder saw one behind the headline and named nothing else.
  const led =
    output.behind_headline === 'photo' && !NOT_A_PHOTO.test(output.behind_headline_evidence)
  if (!plan) return { ...NONE, led }
  const local = plan.soften.map((b) => scaled(b, 1, plan.crop))
  const cssCrop = cropImage(shot.img, plan.crop)
  for (const b of local) erase(cssCrop, b)
  const measured = photoQuality(cssCrop, plan.place, local)
  // Offered, never cut: under a pop-up's dark layer (the photo is the layer's colour), with a
  // cookie banner on the screenshot (a crop could carry it), where
  // the finder saw no photo behind the headline or named something else (a gradient, a
  // plain panel), a photo along the band's foot (it runs up behind the words), and one
  // carrying the site's own labels or badges no crop leaves out (a price tag, a seal).
  const refused = dimmed
    ? 'the photo is dimmed by a pop-up in the screenshot'
    : output.cookie_banner || shot.told?.banner
      ? 'a cookie banner covers part of the screenshot'
      : !led
        ? 'the hero is not led by a photo'
        : plan.place === 'edge'
          ? 'the photo sits under the words, where a crop would run behind them'
          : plan.marked
            ? 'the site’s own labels or badges sit on the photo, with no clear part large enough'
            : null
  const quality = refused ? { ...measured, ok: false, why: refused } : measured
  if (!quality.ok || !store) return { led, plan, quality, placed: null }

  // Cut from the sharpest source: the photo's extent, the site's words taken out, then the crop.
  const { img, scale } = sourceFor(shot, plan.region)
  const region = cropImage(img, scaled(plan.region, scale))
  for (const b of plan.soften) erase(region, scaled(b, scale, plan.region))
  const crop = cropImage(region, scaled(plan.crop, scale, plan.region))
  const fit = (image: Image) => downscale(image, Math.ceil(image.width / MAX_STORED))
  const [key, source] = await Promise.all([
    store(encodeJpeg(fit(crop), QUALITY), 'hero.jpg'),
    store(encodeJpeg(fit(region), QUALITY), 'hero-source.jpg'),
  ])
  if (!key || !source) return { led, plan, quality, placed: null }
  const rw = plan.region[2] - plan.region[0]
  const rh = plan.region[3] - plan.region[1]
  const round = (v: number) => Math.round(v * 10_000) / 10_000
  return {
    led,
    plan,
    quality,
    placed: {
      key,
      source,
      box: {
        x: round((plan.crop[0] - plan.region[0]) / rw),
        y: round((plan.crop[1] - plan.region[1]) / rh),
        w: round((plan.crop[2] - plan.crop[0]) / rw),
        h: round((plan.crop[3] - plan.crop[1]) / rh),
      },
      focus: photoFocus(cssCrop, local),
      shade: plan.place === 'cover' ? photoShade(cssCrop) : null,
      alt: photoAlt(output.behind_headline_evidence),
    },
  }
}

const COLOURED = new Set(['brand', 'support', 'blend'])
/** The side a focal point leans to (as the hero panel's focal point does). */
const sideOf = (x: number) => (x < 34 ? 'left' : x > 66 ? 'right' : 'centre')

/**
 * The photo as changes to the draft. Placed: the image, where it sits
 * (measured), its focal point, and behind the words a full band of colour (so
 * phones and the image's edges keep a colour) with the header on it where
 * the site's header sits on the photo. Not placed: where a photo would sit,
 * so one added from the chip lands where the site has it; and a photo an
 * earlier match cut from another screenshot (`had`) goes, so one brand's
 * photo never stays on another. A photo the customer uploaded stays.
 */
export function photoChanges(
  photo: BrandPhoto,
  band: string,
  had?: PortalDesign['brand']['heroImage'] | null
): BrandChange[] {
  const { plan, placed } = photo
  const stale: BrandChange[] =
    had?.screenshot && !placed
      ? [
          { path: 'brand.heroImage', value: null, why: 'the photo cut from an earlier screenshot' },
          {
            path: 'layout.imagePoint',
            value: null,
            why: 'the photo cut from an earlier screenshot',
          },
          {
            path: 'layout.imageFocus',
            value: null,
            why: 'the photo cut from an earlier screenshot',
          },
        ]
      : []
  if (!plan) return stale
  const where = { path: 'layout.imagePlace', value: plan.place, why: plan.why }
  if (!placed) return [...stale, where]
  const from = 'the photo from your screenshot: replace it with the original for best quality'
  const changes: BrandChange[] = [
    {
      path: 'brand.heroImage',
      value: {
        key: placed.key,
        ...(placed.alt ? { alt: placed.alt } : { decorative: true }),
        screenshot: { key: placed.source, box: placed.box },
        ...(placed.shade ? { shade: placed.shade } : {}),
        // Home's hero only: the other pages keep short heroes and the picture never repeats.
        homeOnly: true,
      },
      why: from,
    },
    where,
    { path: 'layout.imagePoint', value: placed.focus, why: 'the photo’s subject' },
    { path: 'layout.imageFocus', value: sideOf(placed.focus.x), why: 'the photo’s subject' },
  ]
  if (plan.place === 'cover') {
    changes.push(
      {
        path: 'layout.hero',
        value: COLOURED.has(band) ? band : 'brand',
        why: 'the site’s photo fills the hero behind the words',
      },
      { path: 'layout.heroShape', value: 'full', why: 'the site’s photo runs edge to edge' },
      { path: 'layout.imagePhone', value: 'show', why: 'the words sit on the photo on phones too' },
      {
        // The photo is Home's only, so the header keeps its own colour on every page.
        path: 'layout.headerOnHero',
        value: false,
        why: 'the photo shows on Home only, so the header keeps its own colour',
      }
    )
  }
  return changes
}

/** The files the match brings to the design: the logo's, and a placed photo's. */
export const photoFiles = (photo: BrandPhoto, logoKey?: string | null): Set<string> =>
  new Set([
    ...(logoKey ? [logoKey] : []),
    ...(photo.placed ? [photo.placed.key, photo.placed.source] : []),
  ])

/**
 * The photo stage within its time: `ms` left in the match (nothing is stored
 * past it), at most `budget`. A screenshot under a pop-up's dimming (the
 * primary is one only when no clean screenshot was sent) is never cut from:
 * the photo is offered instead. Out of time or failed, offered where the
 * finder saw one.
 */
export async function photoStage(
  shot: Shot,
  store: PhotoStore | undefined,
  ms: number,
  budget: number
): Promise<BrandPhoto> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), Math.max(0, Math.min(budget, ms)))
  })
  try {
    const found = await Promise.race([
      brandPhoto(shot, ms > 0 ? store : undefined, { dimmed: isDimmed(shot) }),
      late,
    ])
    return found ?? unmeasuredPhoto(shot)
  } catch {
    return unmeasuredPhoto(shot)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * What the reply says of the photo: placed (it is in the design as applied),
 * only offered (the site leads with one), or nothing; and why a photo seen
 * was not placed.
 */
export function photoSaid(
  photo: BrandPhoto,
  design: PortalDesign
): { photo: 'placed' | 'offered' | null; photoWhy: string | null } {
  const placed = !!photo.placed && design.brand.heroImage?.key === photo.placed.key
  return {
    photo: placed ? 'placed' : photo.led ? 'offered' : null,
    photoWhy: photo.quality && !photo.quality.ok ? photo.quality.why : null,
  }
}
