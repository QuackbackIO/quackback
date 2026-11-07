/**
 * What a brand's own website adds to a match from its screenshots. The site's
 * code names things the pixels can only guess: its fonts, its logo and
 * favicon files, its exact colours and its name. The pixels still decide how
 * the portal looks: which colour plays which role, the hero, the layout.
 *
 * - Fonts: a family the portal bundles is used as itself; an open-licence or
 *   proprietary one is a strong hint to the fitting (its nearest bundled face,
 *   and whether it is a serif). A brand's own font files are never fetched or
 *   kept: webfont licences are usually tied to the brand's own domain.
 * - Logo: the site's file replaces the cut from the screenshot only when its
 *   shape and colours agree with the cut, so a header icon, a social banner
 *   or an old logo never stands in for what the page shows.
 * - Favicon and share image: set from the site when the design has none.
 * - Colours: a measured role colour a hair off one the site's CSS names is
 *   taken as the site's exact value.
 * - Words: the name the site gives itself and what it says about itself.
 */
import { BUNDLED_FONTS, closestWeight, type BundledFontId } from '@/lib/shared/design/fonts'
import { nearestBundledFont } from '@/lib/shared/design/font-match'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { sanitizeSvg } from '@/lib/server/content/svg-sanitize'
import { deltaE00, parseColor, type RGB } from '../extract/color'
import { decodeImage } from '../extract/image'
import type { Image } from '../extract/png'
import type { ColourRoles } from '../extract/roles'
import type { BrandChange } from './brand-decide'
import type { FoundLogo } from './brand-measure'
import type { FaceHint } from './brand-fonts'
import type { ColourCandidate, FontFact, SiteAsset, SiteFacts } from '../site/types'

// ---------------------------------------------------------------- fonts

/** How a family the site names becomes a face the portal draws. */
export interface FontResolution {
  /** The family as the site names it. */
  family: string
  /**
   * bundled: the portal bundles this very face. nearest: an open-licence or
   * proprietary face, drawn in the bundled face nearest it. unknown: no
   * bundled face is known to be near; the fitting decides from the pixels.
   */
  how: 'bundled' | 'nearest' | 'unknown'
  /** An open-licence face (hosted by a public font service), not bundled. */
  open: boolean
  id: BundledFontId | null
  generic: FontFact['generic']
  /** Why, as a reply says it. */
  why: string
}

const bare = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(variable|var|vf|web)\b/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Bundled faces by their bare label, longest first, so Inter Tight is tried before Inter. */
const LABELS = (Object.entries(BUNDLED_FONTS) as Array<[BundledFontId, { label: string }]>)
  .map(([id, font]) => ({ id, label: bare(font.label) }))
  .sort((a, b) => b.label.length - a.label.length)

/** Words a site's build adds to a family's name that do not change the face. */
const SUFFIXES = ['', 'sans', 'text', 'display', 'variable', 'vf', 'web', 'font']

/**
 * The bundled face a family is, or null. A family named for a bundled face
 * with a build's suffix (`GeistSans`), or a brand's own cut of one under its
 * name (`BrandInter`, a short prefix), is that face.
 */
export function bundledFace(family: string): BundledFontId | null {
  const name = bare(family)
  if (!name) return null
  for (const { id, label } of LABELS) {
    if (SUFFIXES.some((suffix) => name === label + suffix)) return id
    // A digit is a version (Source Serif 4).
    if (name.replace(/\d+$/, '') === label) return id
  }
  for (const { id, label } of LABELS) {
    if (label.length < 5) continue
    const at = name.lastIndexOf(label)
    if (at > 0 && at <= 8 && at + label.length === name.length) return id
  }
  return null
}

const SYSTEM_FAMILY =
  /^(system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace)$/i

/** How the family a site names for a role is drawn. */
export function resolveSiteFont(
  fact: FontFact | null,
  hosted: readonly string[] = []
): FontResolution | null {
  if (!fact?.family) return null
  const family = fact.family
  // A stack that leaves the face to the system is the CSS's default, not a face the brand chose.
  if (SYSTEM_FAMILY.test(family))
    return {
      family,
      how: 'unknown',
      open: false,
      id: null,
      generic: fact.generic,
      why: 'your site leaves it to the system’s font',
    }
  const exact = bundledFace(family)
  if (exact)
    return {
      family,
      how: 'bundled',
      open: true,
      id: exact,
      generic: fact.generic,
      why: `your site sets it in ${family}`,
    }
  const open = hosted.some((h) => bare(h) === bare(family))
  // The family's own name first, then its stack (a brand face falls back to the face it is closest to).
  const near = nearestBundledFont(family) ?? nearestBundledFont(fact.stack.join(', '))
  const kind = fact.generic === 'mono' ? 'monospace' : fact.generic
  if (near)
    return {
      family,
      how: 'nearest',
      open,
      id: near,
      generic: fact.generic,
      why: `your site sets it in ${family}${open ? '' : `, which is licensed to your site`}; ${BUNDLED_FONTS[near].label} is the bundled face nearest it`,
    }
  return {
    family,
    how: 'unknown',
    open,
    id: null,
    generic: fact.generic,
    why: `your site sets it in ${family}${kind ? `, a ${kind}` : ''}; the closest bundled ${kind ?? 'face'} drawn`,
  }
}

export interface SiteFontPlan {
  heading: FontResolution | null
  body: FontResolution | null
  /**
   * The heading's family is only the body's, as the headings inherit it (the
   * same family from the same rule), or none was found: a headline may well
   * be set in another face by a rule the reader cannot see, so the fitting
   * takes no hint for it.
   */
  headingInherited: boolean
}

export function siteFontPlan(facts: SiteFacts | null | undefined): SiteFontPlan {
  if (!facts) return { heading: null, body: null, headingInherited: false }
  const hosted = facts.fonts.hosted
  const { heading, body } = facts.fonts
  return {
    heading: resolveSiteFont(heading ?? body, hosted),
    body: resolveSiteFont(body, hosted),
    headingInherited:
      !heading || (!!body && heading.family === body.family && heading.from === body.from),
  }
}

/** The hints the font fitting takes from the site, per role. */
export function faceHints(plan: SiteFontPlan): {
  headline: FaceHint | null
  body: FaceHint | null
} {
  const hint = (r: FontResolution | null): FaceHint | null =>
    r && (r.id || r.generic)
      ? { id: r.id, exact: r.how === 'bundled', kind: r.generic, why: r.why }
      : null
  return { headline: plan.headingInherited ? null : hint(plan.heading), body: hint(plan.body) }
}

/** A plain bundled face of each kind, for a family no near face is known for. */
const KIND_DEFAULT: Record<'sans' | 'serif' | 'mono', BundledFontId> = {
  sans: 'inter',
  serif: 'source-serif',
  mono: 'jetbrains',
}

/**
 * The faces to set from the site where the fitting set none (no screenshot,
 * or text it could not read): its own face where bundled, else the nearest.
 */
export function siteFontChanges(
  plan: SiteFontPlan,
  design: PortalDesign,
  set: { heading: boolean; body: boolean }
): BrandChange[] {
  const out: BrandChange[] = []
  const headingId =
    plan.heading?.id ?? (plan.heading ? KIND_DEFAULT[plan.heading.generic ?? 'sans'] : null)
  const bodyId = plan.body?.id ?? (plan.body ? KIND_DEFAULT[plan.body.generic ?? 'sans'] : null)
  if (!set.heading && plan.heading && headingId) {
    const font = { kind: 'bundled' as const, id: headingId }
    out.push({ path: 'brand.fonts.heading', value: font, why: plan.heading.why })
    const weight = closestWeight(font, design.brand.fonts.headingWeight)
    if (weight !== design.brand.fonts.headingWeight)
      out.push({
        path: 'brand.fonts.headingWeight',
        value: weight,
        why: `a weight ${BUNDLED_FONTS[headingId].label} loads`,
      })
  }
  if (!set.body && plan.body && bodyId)
    out.push({
      path: 'brand.fonts.body',
      value: { kind: 'bundled', id: bodyId === 'inter-tight' ? 'inter' : bodyId },
      why: plan.body.why,
    })
  return out
}

// ---------------------------------------------------------------- logo

export interface LogoAgreement {
  agrees: boolean
  why: string
}

/** Width over height, as a log, so twice as wide and half as wide are as far off. */
const logRatio = (a: number, b: number) => Math.abs(Math.log(a / b))
/** How far the site's logo's shape may be from the cut's: a viewBox carries some padding. */
const SHAPE = { raster: 0.2, svg: 0.25 }
/** A colour the cut's ink shows, matched by one of the site logo's within this distance. */
const COLOUR_NEAR = 15
/** The cut's colours that must be found: those covering at least this share of its ink. */
const MAIN_SHARE = 0.15
/** A raster logo's ink must stand at least this tall to be crisper than the cut. */
const MIN_INK_HEIGHT = 24

const hexOf = ([r, g, b]: RGB) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** The colours an SVG paints with: fills, strokes and gradient stops. */
export function svgColours(markup: string): RGB[] {
  const found = new Map<string, RGB>()
  const re = /(?:fill|stroke|stop-color)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)/gi
  for (const m of markup.matchAll(re)) {
    const value = m[1]!.toLowerCase()
    if (value === 'none' || value === 'transparent' || value === 'currentcolor') continue
    const rgb = parseColor(value)
    if (rgb) found.set(hexOf(rgb), rgb)
  }
  // An SVG with no paint draws in black.
  if (found.size === 0 && /<(path|rect|circle|ellipse|polygon|text)\b/i.test(markup))
    found.set('#000000', [0, 0, 0])
  return [...found.values()]
}

/** The viewBox's width over height, or null. */
export function svgAspect(markup: string): number | null {
  const box = /viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(
    markup
  )
  const w = box ? Number(box[3]) : NaN
  const h = box ? Number(box[4]) : NaN
  return w > 0 && h > 0 ? w / h : null
}

/** A raster logo's ink: its tight bounds and main colours, its background left out. */
export function rasterInk(img: Image): { w: number; h: number; colours: RGB[] } | null {
  const { width, height, data } = img
  const at = (x: number, y: number) => (y * width + x) * 4
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)]
  const opaque = (i: number) => data[i + 3]! > 128
  // A transparent background, or the colour its corners share.
  const bg = corners.every((i) => !opaque(i))
    ? null
    : ([data[corners[0]!]!, data[corners[0]! + 1]!, data[corners[0]! + 2]!] as RGB)
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1,
    n = 0
  const bins = new Map<number, { n: number; s: [number, number, number] }>()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = at(x, y)
      if (!opaque(i)) continue
      const rgb: RGB = [data[i]!, data[i + 1]!, data[i + 2]!]
      if (bg && Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]) < 40)
        continue
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const key = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4)
      const bin = bins.get(key) ?? { n: 0, s: [0, 0, 0] }
      bin.n++
      bin.s[0] += rgb[0]
      bin.s[1] += rgb[1]
      bin.s[2] += rgb[2]
      bins.set(key, bin)
    }
  if (!n) return null
  const colours = [...bins.values()]
    .filter((b) => b.n / n >= 0.08)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((b) => b.s.map((v) => v / b.n) as RGB)
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, colours }
}

/**
 * Whether the site's logo file is the logo the screenshot shows: about the
 * same shape as the cut (an icon is not a wordmark), and every colour that
 * covers much of the cut found in it. An SVG drawn in the text colour is
 * given the cut's ink for the comparison, as it is for the portal.
 */
export function logoAgreement(cut: FoundLogo, asset: SiteAsset): LogoAgreement {
  const [bx0, by0, bx1, by1] = cut.cut.bounds
  const cutAspect = (bx1 - bx0) / Math.max(1, by1 - by0)
  const main = cut.cut.palette.filter((c) => c.share >= MAIN_SHARE).map((c) => c.rgb)
  let aspect: number | null
  let colours: RGB[]
  let tolerance: number
  if (asset.mime === 'image/svg+xml') {
    const markup = new TextDecoder().decode(asset.bytes)
    aspect = svgAspect(markup)
    colours = svgColours(markup)
    tolerance = SHAPE.svg
  } else {
    let img: Image
    try {
      img = decodeImage(asset.bytes)
    } catch {
      return { agrees: false, why: 'the site’s logo file could not be read' }
    }
    const ink = rasterInk(img)
    if (!ink) return { agrees: false, why: 'the site’s logo file is blank' }
    if (ink.h < MIN_INK_HEIGHT)
      return { agrees: false, why: 'the site’s logo file is smaller than the screenshot’s' }
    aspect = ink.w / ink.h
    colours = ink.colours
    tolerance = SHAPE.raster
  }
  if (!aspect) return { agrees: false, why: 'the site’s logo file has no size' }
  const off = logRatio(aspect, cutAspect)
  if (off > tolerance)
    return {
      agrees: false,
      why: `the site’s logo is ${aspect.toFixed(1)} times as wide as tall, the screenshot’s ${cutAspect.toFixed(1)}`,
    }
  const missing = main.find((c) => !colours.some((d) => deltaE00(c, d) < COLOUR_NEAR))
  if (missing)
    return {
      agrees: false,
      why: `the site’s logo has no ${hexOf(missing)}, which the screenshot’s shows`,
    }
  return { agrees: true, why: 'the site’s own logo file, the same as your screenshot shows' }
}

/** The cut's main ink, for an SVG drawn in the text colour. */
export const cutInk = (cut: FoundLogo): string | null => cut.cut.palette[0]?.hex ?? null

/**
 * The site's logo as the portal stores it: an SVG sanitised once more with
 * its text colour set to the cut's ink, a raster as fetched.
 */
export function siteLogoBytes(asset: SiteAsset, ink: string | null): Uint8Array | null {
  if (asset.mime !== 'image/svg+xml') return asset.bytes
  const clean = sanitizeSvg(new TextDecoder().decode(asset.bytes), ink ? { currentColor: ink } : {})
  return clean ? new TextEncoder().encode(clean) : null
}

// ---------------------------------------------------------------- favicon and share image

export function siteAssetChanges(
  design: PortalDesign,
  keys: { favicon: string | null; shareImage: string | null }
): BrandChange[] {
  const out: BrandChange[] = []
  if (keys.favicon && !design.brand.favicon)
    out.push({
      path: 'brand.favicon',
      value: { key: keys.favicon },
      why: 'your site’s own favicon',
    })
  if (keys.shareImage && !design.brand.shareImage)
    out.push({
      path: 'brand.shareImage',
      value: { key: keys.shareImage },
      why: 'the picture your site shows when it is shared',
    })
  return out
}

// ---------------------------------------------------------------- colours

/** A measured colour this close to one the site names is taken as the site's exact value. */
const SNAP = 6
/** A site colour this close to a measured one settles a role the rules left open. */
const SETTLES = 10

function nearest(hex: string, candidates: readonly ColourCandidate[], within: number) {
  const rgb = parseColor(hex)
  if (!rgb) return null
  let best: { hex: string; d: number } | null = null
  for (const c of candidates) {
    const other = parseColor(c.hex)
    if (!other) continue
    const d = deltaE00(rgb, other)
    if (d <= within && (!best || d < best.d)) best = { hex: c.hex, d }
  }
  return best
}

/**
 * The roles as measured, each colour a hair off one the site's CSS names
 * taken as the site's exact value, and an open decision (brand colour,
 * button) settled where the site names the measured colour as its brand's.
 */
export function withSiteColours(
  roles: ColourRoles,
  candidates: readonly ColourCandidate[]
): { roles: ColourRoles; snapped: string[] } {
  if (!candidates.length) return { roles, snapped: [] }
  const snapped: string[] = []
  const snap = (hex: string, what: string) => {
    const found = nearest(hex, candidates, SNAP)
    if (!found || found.hex === hex.toLowerCase()) return hex
    snapped.push(`${what} ${hex} to ${found.hex}`)
    return found.hex
  }
  const strong = candidates.filter((c) => c.weight >= 2)
  const open = roles.open.filter((decision) => {
    const value =
      decision === 'identity'
        ? roles.identity.value
        : decision === 'action'
          ? roles.action.value.hex
          : roles.highlight.value
    return !(value && nearest(value, strong, SETTLES))
  })
  return {
    roles: {
      ...roles,
      identity: { ...roles.identity, value: snap(roles.identity.value, 'the brand colour') },
      action: {
        ...roles.action,
        value: { ...roles.action.value, hex: snap(roles.action.value.hex, 'the button') },
      },
      links: {
        ...roles.links,
        value: { ...roles.links.value, hex: snap(roles.links.value.hex, 'links') },
      },
      highlight: {
        ...roles.highlight,
        value: roles.highlight.value ? snap(roles.highlight.value, 'the second colour') : null,
      },
      open,
    },
    snapped,
  }
}

export { siteName, usable } from './brand-site-words'
