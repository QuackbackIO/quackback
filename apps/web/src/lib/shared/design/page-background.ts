/**
 * The page behind everything: its own colour (solid, as every design before
 * had), a soft wash of a colour, a gradient, an uploaded image, or a quiet
 * pattern. The site has one; any page may have its own over it; dark mode
 * draws the same choice in dark's colours unless it is given one of its own.
 *
 * Text on the page stays readable whatever is behind it: a colour is drawn
 * as a pale wash of itself, an exact colour as given in light mode, each
 * moved toward the page's own colour until the text reads on it; an image
 * sits under a layer of the page's colour (dimming it on dark, lightening it
 * on light) as strong as its measured tones need; a pattern's ink is kept
 * faint. Cards, menus and fields keep their own surfaces. Pure: the server's
 * resolver and the builder's preview draw the same CSS.
 */
import { z } from 'zod'
import { formatOklch, parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch, oklchToHex } from '@/lib/shared/theme/colors'
import { mixColor, normaliseColor } from './color'
import { ownColour } from './colour-roles'
import { contrastRatio, overlay } from './contrast'
import { DESIGN_OPTIONS } from './options'
import type { PortalDesign } from './schema'

type Mode = 'light' | 'dark'

/* The schema */

const colour = z.string().transform((value, ctx) => {
  const normalised = normaliseColor(value)
  if (normalised === null) {
    ctx.addIssue({ code: 'custom', message: `"${value}" is not a colour a design can use` })
    return z.NEVER
  }
  return normalised
})

/** A brand colour by its role ("accent"), the page's own ("page"), or an exact colour. */
const colourRef = z.union([z.enum(DESIGN_OPTIONS.backgroundColour), colour])

/**
 * Where an uploaded background image is kept. The key is written into the
 * page's CSS, so it holds only characters that cannot end a `url()`.
 */
export const BACKGROUND_IMAGE_KEY =
  /^portal-images\/(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*$/

const imageKey = z.string().max(512).regex(BACKGROUND_IMAGE_KEY)
const strength = z.enum(DESIGN_OPTIONS.backgroundStrength)

const fills = [
  z.object({ kind: z.literal('solid') }).strict(),
  z
    .object({
      kind: z.literal('tint'),
      colour: colourRef,
      /** Absent: an exact colour as given, a brand colour as a soft wash. */
      strength: strength.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gradient'),
      /** From the first colour to the last. */
      stops: z.array(colourRef).min(2).max(3),
      /** Absent is linear. */
      shape: z.enum(DESIGN_OPTIONS.gradientShape).optional(),
      /** A linear gradient's way; absent is down. */
      direction: z.enum(DESIGN_OPTIONS.gradientDirection).optional(),
      /** Where a radial glow starts; absent is the top. */
      centre: z.enum(DESIGN_OPTIONS.gradientCentre).optional(),
      /** Absent is faint. */
      strength: strength.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('image'),
      image: z
        .object({
          key: imageKey,
          /** A smaller copy for phones. */
          phone: z.object({ key: imageKey }).strict().optional(),
          /** Its darkest and lightest tones, measured on upload; absent assumes black and white. */
          tones: z.tuple([colour, colour]).optional(),
        })
        .strict(),
      /** Absent is cover. */
      fit: z.enum(DESIGN_OPTIONS.backgroundFit).optional(),
      /** Absent is the centre. */
      position: z.enum(DESIGN_OPTIONS.backgroundPosition).optional(),
      /** How much of the image shows through, in percent; absent is 35. Readability may hold it back. */
      strength: z.number().int().min(0).max(100).optional(),
      /** Absent scrolls with the page. */
      scroll: z.enum(DESIGN_OPTIONS.backgroundScroll).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pattern'),
      pattern: z.enum(DESIGN_OPTIONS.pattern),
      /** Absent is the brand colour. */
      colour: colourRef.optional(),
      /** Absent is medium. */
      scale: z.enum(DESIGN_OPTIONS.patternScale).optional(),
      /** Absent is faint. */
      strength: strength.optional(),
    })
    .strict(),
] as const

/** One way of drawing the page. */
export const backgroundFillSchema = z.discriminatedUnion('kind', [...fills])

/** A page background: a fill, with dark mode's own when it is not worked out from light's. */
const withDark = <T extends (typeof fills)[number]>(fill: T) =>
  fill.extend({ dark: backgroundFillSchema.optional() })
export const pageBackgroundSchema = z.discriminatedUnion('kind', [
  withDark(fills[0]),
  withDark(fills[1]),
  withDark(fills[2]),
  withDark(fills[3]),
  withDark(fills[4]),
])

/** Each page's own background, over the site's. */
export const pageBackgroundsSchema = z.partialRecord(
  z.enum(DESIGN_OPTIONS.backgroundPage),
  pageBackgroundSchema
)

export type BackgroundFill = z.output<typeof backgroundFillSchema>
export type PageBackground = BackgroundFill & { dark?: BackgroundFill }
export type BackgroundKind = BackgroundFill['kind']
export type BackgroundPage = (typeof DESIGN_OPTIONS.backgroundPage)[number]
export type BackgroundColour = Extract<BackgroundFill, { kind: 'tint' }>['colour']

/* Which background a page shows */

const SOLID: BackgroundFill = { kind: 'solid' }

/** The site's background, solid when the design sets none. */
export const siteBackground = (doc: PortalDesign): PageBackground =>
  (doc.layout.background as PageBackground | undefined) ?? SOLID

/** The page's own background, or null when it follows the site's. */
export const ownBackground = (doc: PortalDesign, page: BackgroundPage): PageBackground | null =>
  (doc.layout.pageBackgrounds?.[page] as PageBackground | undefined) ?? null

/** The fill a page shows in a mode: its own, else the site's; dark's own, else light's drawn in dark. */
export function fillFor(
  doc: PortalDesign,
  page: BackgroundPage | null,
  mode: Mode
): BackgroundFill {
  const chosen = (page && ownBackground(doc, page)) || siteBackground(doc)
  const { dark, ...light } = chosen
  return mode === 'dark' && dark ? dark : (light as BackgroundFill)
}

/** Whether a design draws anything but its page colour behind any page. */
export function hasPageBackground(doc: PortalDesign): boolean {
  const all: Array<PageBackground | undefined> = [
    siteBackground(doc),
    ...(Object.values(doc.layout.pageBackgrounds ?? {}) as PageBackground[]),
  ]
  return all.some((bg) => bg && (bg.kind !== 'solid' || (bg.dark && bg.dark.kind !== 'solid')))
}

/** The page a designer page's background is kept under: an item page under its own page. */
export function backgroundPageOf(page: string | null | undefined): BackgroundPage | null {
  return (DESIGN_OPTIONS.backgroundPage as readonly string[]).includes(page ?? '')
    ? (page as BackgroundPage)
    : null
}

/* Drawing a fill */

/** What a mode's colours are, as a fill needs them. */
export interface BackgroundGround {
  /** The page's own colour. */
  page: string
  /** The text on it. */
  ink: string
  /** The brand colour, as solved. */
  accent: string
}

export interface DrawnBackground {
  kind: BackgroundKind
  /** The `background` value for the page. */
  css: string
  /** On phones, where it differs: a smaller image, never held still. */
  phone?: string
  /** On larger screens with a pointer, where it differs: an image held still. */
  wide?: string
  /** Every colour text on the page may sit on, the worst included. */
  behind: string[]
  /** The colour along the page's top, which the header takes. */
  top: string
  /** Whether a colour was moved toward the page so text reads on it. */
  softened: boolean
}

/** The contrast page text keeps on a wash, gradient or pattern, and on an image's layer. */
export const PAGE_TEXT = 4.5
export const IMAGE_TEXT = 7

/** How far a wash steps from the page, and how much colour it keeps, by strength. */
const TINT_DEPTH: Record<z.output<typeof strength>, number> = {
  faint: 0.025,
  soft: 0.05,
  strong: 0.09,
}
const GRADIENT_DEPTH: Record<z.output<typeof strength>, number> = {
  faint: 0.05,
  soft: 0.09,
  strong: 0.15,
}
const CHROMA: Record<z.output<typeof strength>, number> = { faint: 0.04, soft: 0.07, strong: 0.1 }
/** A pattern's ink, over the page. */
const PATTERN_ALPHA: Record<z.output<typeof strength>, number> = {
  faint: 0.12,
  soft: 0.18,
  strong: 0.26,
}
const PATTERN_TILE: Record<(typeof DESIGN_OPTIONS.patternScale)[number], number> = {
  small: 12,
  medium: 20,
  large: 32,
}
const DEFAULT_IMAGE_STRENGTH = 35

const toHex = (value: string) => (value.startsWith('#') ? value : oklchToHex(value))

/** A pale wash of a colour near the page: the page's lightness stepped by depth, in the colour's hue. */
export function washOf(value: string, page: string, depth: number, chroma: number): string {
  const parse = (c: string) => parseOklch(c.startsWith('#') ? hexToOklch(c) : c)
  const own = parse(value)
  const ground = parse(page)
  if (!own || !ground) return mixColor(value, page, depth * 2)
  const l = ground.l > 0.5 ? ground.l - depth : ground.l + depth
  return oklchToHex(formatOklch(Math.min(1, Math.max(0, l)), Math.min(own.c * 0.6, chroma), own.h))
}

/** A colour moved toward the page until text reads on it at the target. */
function readableGround(
  value: string,
  ground: BackgroundGround,
  target: number
): { colour: string; moved: boolean } {
  if (contrastRatio(ground.ink, value) >= target) return { colour: value, moved: false }
  for (let share = 0.9; share > 0; share -= 0.05) {
    const next = mixColor(value, ground.page, share)
    if (contrastRatio(ground.ink, next) >= target) return { colour: next, moved: true }
  }
  return { colour: ground.page, moved: true }
}

/** A colour a fill names, in a mode: the page's own, a brand colour, or an exact one. */
function namedColour(
  doc: PortalDesign,
  ref: BackgroundColour,
  ground: BackgroundGround,
  mode: Mode
): { value: string; exact: boolean } {
  if (ref === 'page') return { value: ground.page, exact: true }
  if (ref === 'accent') return { value: ground.accent, exact: false }
  if (ref === 'support' || ref === 'extra1' || ref === 'extra2')
    return { value: ownColour(doc, mode, ref) ?? ground.accent, exact: false }
  return { value: ref, exact: true }
}

/**
 * A colour as a wash or gradient draws it: an exact colour as given in light
 * mode unless a strength is asked for, else a wash of it at the depth; then
 * moved toward the page until text reads on it.
 */
function drawnColour(
  doc: PortalDesign,
  ref: BackgroundColour,
  ground: BackgroundGround,
  mode: Mode,
  wash: { depth: number; chroma: number; asked: boolean }
): { colour: string; moved: boolean } {
  const named = namedColour(doc, ref, ground, mode)
  if (ref === 'page') return { colour: ground.page, moved: false }
  const asGiven = named.exact && mode === 'light' && !wash.asked
  const base = asGiven
    ? toHex(named.value)
    : washOf(named.value, ground.page, wash.depth, wash.chroma)
  return readableGround(base, ground, PAGE_TEXT)
}

const ANGLE: Record<(typeof DESIGN_OPTIONS.gradientDirection)[number], string> = {
  down: '180deg',
  up: '0deg',
  right: '90deg',
  left: '270deg',
  diagonal: '135deg',
}
const GLOW_AT: Record<(typeof DESIGN_OPTIONS.gradientCentre)[number], string> = {
  top: '50% 0%',
  middle: '50% 45vh',
  corner: '0% 0%',
}
const POSITION: Record<(typeof DESIGN_OPTIONS.backgroundPosition)[number], string> = {
  top: 'center top',
  centre: 'center',
  bottom: 'center bottom',
}

/** Where a stored file is loaded from, as a CSS image. */
const storedImage = (key: string) => `url("/api/storage/${key}")`

/** A pattern's motif as a tile, in one colour at an opacity. */
export function patternSvg(
  pattern: (typeof DESIGN_OPTIONS.pattern)[number],
  ink: string,
  alpha: number
): string {
  const a = +alpha.toFixed(3)
  const body = {
    dots: `<circle cx='10' cy='10' r='1.6' fill='${ink}' fill-opacity='${a}'/>`,
    grid: `<path d='M20 0H0V20' fill='none' stroke='${ink}' stroke-opacity='${a}' stroke-width='1'/>`,
    lines: `<path d='M-5 5 5-5M0 20 20 0M15 25 25 15' stroke='${ink}' stroke-opacity='${a}' stroke-width='1.25'/>`,
    cross: `<path d='M10 6.5v7M6.5 10h7' stroke='${ink}' stroke-opacity='${a}' stroke-width='1.25'/>`,
  }[pattern]
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>${body}</svg>`
}

/**
 * The layer over an image, as opaque as the page's text needs on its darkest
 * and lightest tones, and at least as the strength leaves it.
 */
export function imageLayer(
  tones: readonly [string, string] | undefined,
  ground: BackgroundGround,
  strengthPercent: number
): { alpha: number; behind: string[] } {
  const extremes = tones ? [...tones] : ['#000000', '#ffffff']
  const floor = Math.min(1, Math.max(0, 1 - strengthPercent / 100))
  const reads = (alpha: number) =>
    extremes.every(
      (tone) => contrastRatio(ground.ink, overlay(ground.page, tone, alpha)) >= IMAGE_TEXT
    )
  let alpha = floor
  while (alpha < 1 && !reads(alpha)) alpha = Math.min(1, +(alpha + 0.02).toFixed(2))
  return { alpha, behind: extremes.map((tone) => overlay(ground.page, tone, alpha)) }
}

/** A fill drawn in a mode's colours. */
export function drawFill(
  doc: PortalDesign,
  fill: BackgroundFill,
  ground: BackgroundGround,
  mode: Mode
): DrawnBackground {
  const page = ground.page
  switch (fill.kind) {
    case 'tint': {
      const s = fill.strength ?? 'soft'
      const drawn = drawnColour(doc, fill.colour, ground, mode, {
        depth: TINT_DEPTH[s],
        chroma: CHROMA[s],
        asked: !!fill.strength,
      })
      return {
        kind: 'tint',
        css: drawn.colour,
        behind: [drawn.colour],
        top: drawn.colour,
        softened: drawn.moved,
      }
    }
    case 'gradient': {
      const s = fill.strength ?? 'faint'
      const drawn = fill.stops.map((stop) =>
        drawnColour(doc, stop, ground, mode, {
          depth: GRADIENT_DEPTH[s],
          chroma: CHROMA[s],
          asked: !!fill.strength,
        })
      )
      const stops = drawn.map((each) => each.colour)
      const first = stops[0]!
      const last = stops.at(-1)!
      const radial = fill.shape === 'radial'
      const centre = fill.centre ?? 'top'
      const css = radial
        ? `radial-gradient(140vw 100vh at ${GLOW_AT[centre]}, ${stops.join(', ')}) ${last}`
        : `linear-gradient(${ANGLE[fill.direction ?? 'down']}, ${stops.join(', ')})`
      const direction = fill.direction ?? 'down'
      const top = radial
        ? centre === 'middle'
          ? last
          : mixColor(first, last, 0.5)
        : direction === 'down'
          ? first
          : direction === 'up'
            ? last
            : mixColor(first, last, 0.5)
      return {
        kind: 'gradient',
        css,
        behind: [...new Set([...stops, top])],
        top,
        softened: drawn.some((each) => each.moved),
      }
    }
    case 'pattern': {
      const s = fill.strength ?? 'faint'
      const ink = toHex(namedColour(doc, fill.colour ?? 'accent', ground, mode).value)
      let alpha = PATTERN_ALPHA[s]
      let softened = false
      while (alpha > 0.02 && contrastRatio(ground.ink, overlay(ink, page, alpha)) < PAGE_TEXT) {
        alpha = +(alpha - 0.02).toFixed(2)
        softened = true
      }
      const tile = PATTERN_TILE[fill.scale ?? 'medium']
      const svg = patternSvg(fill.pattern, ink, alpha)
      return {
        kind: 'pattern',
        css: `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${tile}px ${tile}px repeat ${page}`,
        behind: [page, overlay(ink, page, alpha)],
        top: page,
        softened,
      }
    }
    case 'image': {
      const strengthPercent = fill.strength ?? DEFAULT_IMAGE_STRENGTH
      const layer = imageLayer(fill.image.tones, ground, strengthPercent)
      const veil = `color-mix(in srgb, ${page} ${Math.round(layer.alpha * 100)}%, transparent)`
      const position = POSITION[fill.position ?? 'centre']
      const fit = fill.fit ?? 'cover'
      const size = fit === 'tile' ? 'auto' : fit
      const repeat = fit === 'tile' ? 'repeat' : 'no-repeat'
      const draw = (key: string, attach: string) =>
        `linear-gradient(${veil}, ${veil})${attach}, ${storedImage(key)} ${position} / ${size} ${repeat}${attach}, ${page}`
      return {
        kind: 'image',
        css: draw(fill.image.key, ''),
        ...(fill.image.phone ? { phone: draw(fill.image.phone.key, '') } : {}),
        ...(fill.scroll === 'fixed' && fit !== 'tile'
          ? { wide: draw(fill.image.key, ' fixed') }
          : {}),
        behind: layer.behind,
        top: page,
        softened: layer.alpha > Math.max(0, 1 - strengthPercent / 100) + 1e-9,
      }
    }
    default:
      return { kind: 'solid', css: page, behind: [page], top: page, softened: false }
  }
}

/* Every page's background, in a mode */

export interface ModeBackgrounds {
  site: DrawnBackground
  /** The pages with their own, drawn. */
  pages: Partial<Record<BackgroundPage, DrawnBackground>>
}

/** The site's and each page's own background, in a mode's colours. */
export function drawBackgrounds(
  doc: PortalDesign,
  ground: BackgroundGround,
  mode: Mode
): ModeBackgrounds {
  const pages: ModeBackgrounds['pages'] = {}
  for (const page of Object.keys(doc.layout.pageBackgrounds ?? {}) as BackgroundPage[])
    if (ownBackground(doc, page))
      pages[page] = drawFill(doc, fillFor(doc, page, mode), ground, mode)
  return { site: drawFill(doc, fillFor(doc, null, mode), ground, mode), pages }
}

/** Every colour page text may sit on in a mode, across the site and its pages. */
export const backgroundsBehind = (drawn: ModeBackgrounds): string[] => [
  ...new Set([drawn.site, ...Object.values(drawn.pages)].flatMap((bg) => bg!.behind)),
]

/* As CSS */

/** One drawn background's declarations, on the page shell; the header takes its top unless it sits on the hero. */
function declarations(drawn: DrawnBackground, header: boolean): string {
  return [
    `--qb-page-bg: ${drawn.css};`,
    drawn.phone ? `--qb-page-bg-phone: ${drawn.phone};` : '--qb-page-bg-phone: initial;',
    drawn.wide ? `--qb-page-bg-wide: ${drawn.wide};` : '--qb-page-bg-wide: initial;',
    header ? `--qb-header-bg: ${drawn.top}; --header-background: ${drawn.top};` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * The page backgrounds as CSS: each mode's site background on the page shell
 * (`[data-portal]`), each page's own on `[data-qb-page=…]`, a smaller image
 * on phones, an image held still only on larger screens with a pointer, and
 * none in print. Empty for a design that draws only its page colour, so such
 * designs render as before.
 */
export function pageBackgroundCss(
  doc: PortalDesign,
  drawn: { light: ModeBackgrounds | null; dark: ModeBackgrounds | null }
): string {
  if (!hasPageBackground(doc)) return ''
  const header = !(doc.layout.headerOnBand === true && doc.layout.band !== 'none')
  const both = !!drawn.light && !!drawn.dark
  const rules: string[] = []
  const add = (scopes: string[], modeDrawn: ModeBackgrounds) => {
    const at = (suffix: string) =>
      scopes.map((scope) => `${scope} [data-portal]${suffix}`).join(', ')
    rules.push(`${at('')} { ${declarations(modeDrawn.site, header)} }`)
    for (const [page, bg] of Object.entries(modeDrawn.pages))
      rules.push(`${at(`[data-qb-page=${page}]`)} { ${declarations(bg!, header)} }`)
  }
  const primary = drawn.light ?? drawn.dark
  if (!primary) return ''
  add(both ? ['[data-portal-theme]'] : ['[data-portal-theme]', '.dark[data-portal-theme]'], primary)
  if (both) add(['.dark[data-portal-theme]'], drawn.dark!)
  const shell = '[data-portal-theme] [data-portal]'
  rules.push(
    `${shell} { background: var(--qb-page-bg); }`,
    `@media (max-width: 639px) { ${shell} { background: var(--qb-page-bg-phone, var(--qb-page-bg)); } }`,
    `@media (min-width: 1024px) and (hover: hover) { ${shell} { background: var(--qb-page-bg-wide, var(--qb-page-bg)); } }`,
    `@media print { ${shell} { background: none; } }`
  )
  return `@layer design { ${rules.join(' ')} }`
}

/** Plain words for a background, as undo and the AI's replies say it: "Gradient". */
export const BACKGROUND_NAMES: Record<BackgroundKind, string> = {
  solid: 'Page colour',
  tint: 'Soft colour',
  gradient: 'Gradient',
  image: 'Image',
  pattern: 'Pattern',
}

/* Changing a background */

/** Every page, or one page with its own. */
export type BackgroundTarget = 'site' | BackgroundPage

/** The background a target has: the site's (solid when unset), or a page's own (null when it follows the site's). */
export function backgroundOf(doc: PortalDesign, target: BackgroundTarget): PageBackground | null {
  return target === 'site' ? siteBackground(doc) : ownBackground(doc, target)
}

/**
 * Writes a target's background into a draft. For the site, null or the page
 * colour leaves the field out, as designs before page backgrounds had it;
 * for a page, null leaves it following the site's.
 */
export function writeBackground(
  draft: PortalDesign,
  target: BackgroundTarget,
  next: PageBackground | null
): void {
  if (target === 'site') {
    if (!next || (next.kind === 'solid' && !next.dark)) delete draft.layout.background
    else draft.layout.background = next as PortalDesign['layout']['background']
    return
  }
  const pages = { ...draft.layout.pageBackgrounds }
  if (next) pages[target] = next as NonNullable<(typeof pages)[typeof target]>
  else delete pages[target]
  if (Object.keys(pages).length) draft.layout.pageBackgrounds = pages
  else delete draft.layout.pageBackgrounds
}

/** A new background of a kind, before its settings: the brand colour, softly. */
export const BACKGROUND_STARTS: Record<Exclude<BackgroundKind, 'image'>, BackgroundFill> = {
  solid: { kind: 'solid' },
  tint: { kind: 'tint', colour: 'accent' },
  gradient: { kind: 'gradient', stops: ['accent', 'page'] },
  pattern: { kind: 'pattern', pattern: 'dots' },
}

/**
 * A background of a kind with some settings changed: the same kind keeps
 * its other settings and its dark; another kind starts afresh. An image
 * needs one uploaded, so it is null without one.
 */
export function withBackground(
  current: PageBackground | null,
  kind: BackgroundKind,
  settings: Record<string, unknown> = {}
): PageBackground | null {
  if (current?.kind === kind) return { ...current, ...settings } as PageBackground
  if (kind === 'image') return settings.image ? ({ kind, ...settings } as PageBackground) : null
  return { ...BACKGROUND_STARTS[kind], ...settings } as PageBackground
}

/** A page's name as a background's label says it: "Roadmap page background". */
export const BACKGROUND_PAGE_NAMES: Record<BackgroundPage, string> = {
  home: 'Home',
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
  status: 'Status',
  post: 'Post',
}

/** The undo label of a background change: "Page background: Gradient", or a page's own. */
export function backgroundLabel(target: BackgroundTarget, words: string): string {
  return target === 'site'
    ? `Page background: ${words}`
    : `${BACKGROUND_PAGE_NAMES[target]} page background: ${words}`
}

/* An uploaded image's tones */

/** The share of pixels at each end left out, so a stray speck does not set the layer. */
const TONE_TAIL = 0.02

/**
 * An image's darkest and lightest tones from its RGBA pixels, as hex: the
 * colours at the 2nd and 98th percentile of luminance, transparent pixels
 * left out. The layer over the image is made as strong as text needs on
 * both. Null when no pixel shows.
 */
export function imageTones(pixels: ArrayLike<number>): [string, string] | null {
  const shown: Array<[number, number, number, number]> = []
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue
    const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
    shown.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b])
  }
  if (!shown.length) return null
  shown.sort((a, b) => a[0] - b[0])
  const at = (share: number) => shown[Math.min(shown.length - 1, Math.floor(share * shown.length))]!
  const hex = ([, r, g, b]: [number, number, number, number]) =>
    `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
  return [hex(at(TONE_TAIL)), hex(at(1 - TONE_TAIL))]
}
