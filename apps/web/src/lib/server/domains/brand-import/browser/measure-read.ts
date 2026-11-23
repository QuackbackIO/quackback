/**
 * A rendered page's measurements (page-measure.ts) as a `BrandRead`, by the
 * rule the measured fixtures were converted by
 * (fixtures/brand-sites/from-measured.ts), so a live read and a fixture say
 * the same thing about the same page:
 *
 * - page background: the measured one; fully transparent stays `transparent`.
 * - page text: the body's text colour, a translucent one laid over the page.
 * - button: the brand's call to action among the page's buttons (`brandButton`):
 *   its fill, ink, height and radius (px or %).
 * - fonts: the stack most words are set in (else the body's), and the largest
 *   heading's as the headline. The browser's default face alone is no font.
 * - logo colour: an inline logo's text colour, which its `currentColor` draws.
 * - logo: the header's first image or SVG, by its drawn size. Its markup or
 *   bytes are the client's to verify (../browser-reader.ts).
 */
import { hexToOklch, tryCssColorToHex } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import {
  isBrandColour,
  logoHue,
  type BrandRead,
  type CardLooks,
  type Hex,
} from '@/lib/shared/theme/brand-import'
import { isDarkBackground, luminance, sameColour } from '@/lib/shared/theme/colour-setters'
import type { PageButton, PageCandidate, PageDarkMeasure, PageMeasure } from './page-measure'
import { brandThemeColour } from '../site/theme-colour'

type Rgba = [number, number, number, number]

const clampByte = (v: number) => Math.min(255, Math.max(0, v * 255))
/** A linear-light channel as an sRGB one. */
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/** CIE Lab (D50, as CSS has it) as sRGB bytes, out-of-range colours clipped. */
function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const e = 216 / 24389
  const k = 24389 / 27
  const x = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.96422
  const y = l > k * e ? fy ** 3 : l / k
  const z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * 0.82521
  return [
    clampByte(gamma(3.1338561 * x - 1.6168667 * y - 0.4906146 * z)),
    clampByte(gamma(-0.9787684 * x + 1.9161415 * y + 0.033454 * z)),
    clampByte(gamma(0.0719453 * x - 0.2289914 * y + 1.4052427 * z)),
  ]
}

/** A `color()` in a space a page is likely to use, as sRGB bytes; null for any other space. */
function colorSpaceToRgb(
  space: string,
  c: [number, number, number]
): [number, number, number] | null {
  if (space === 'srgb') return [clampByte(c[0]), clampByte(c[1]), clampByte(c[2])]
  if (space === 'srgb-linear')
    return [clampByte(gamma(c[0])), clampByte(gamma(c[1])), clampByte(gamma(c[2]))]
  if (space === 'display-p3') {
    const [r, g, b] = [linear(c[0]), linear(c[1]), linear(c[2])]
    return [
      clampByte(gamma(1.2249401 * r - 0.2249404 * g)),
      clampByte(gamma(-0.0420569 * r + 1.0420571 * g)),
      clampByte(gamma(-0.0196376 * r - 0.0786361 * g + 1.0982735 * b)),
    ]
  }
  return null
}

/** lab(), lch() and color(): the forms a site's own stylesheet keeps in computed styles beside rgb and oklch. */
function parseWideColour(value: string): Rgba | null {
  const match = /^(lab|lch|color)\(([^)]*)\)$/i.exec(value)
  if (!match) return null
  const [channels, alphaPart] = match[2]!.split('/')
  const tokens = channels!.trim().split(/\s+/)
  const space = match[1]!.toLowerCase() === 'color' ? tokens.shift()?.toLowerCase() : undefined
  if (tokens.length !== 3) return null
  const number = (token: string, percentOf: number) =>
    token.endsWith('%') ? (Number(token.slice(0, -1)) / 100) * percentOf : Number(token)
  const alpha = alphaPart === undefined ? 1 : number(alphaPart.trim(), 1)
  const kind = match[1]!.toLowerCase()
  const scale = kind === 'lab' ? [100, 125, 125] : kind === 'lch' ? [100, 150, 360] : [1, 1, 1]
  const c = tokens.map((token, i) => number(token, scale[i]!)) as [number, number, number]
  if ([...c, alpha].some((n) => !Number.isFinite(n))) return null
  let rgb: [number, number, number] | null
  if (kind === 'lab') rgb = labToRgb(c[0], c[1], c[2])
  else if (kind === 'lch') {
    const hue = (c[2] * Math.PI) / 180
    rgb = labToRgb(c[0], c[1] * Math.cos(hue), c[1] * Math.sin(hue))
  } else rgb = space ? colorSpaceToRgb(space, c) : null
  return rgb ? [rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, alpha))] : null
}

/**
 * A colour as computed styles give it: rgb(), hex, or the hsl(), oklch(),
 * oklab(), lab(), lch() or color() a site defined. A channel written `none`
 * counts as nothing.
 */
export function parseCssColour(raw: string): Rgba | null {
  const value = raw.trim().replace(/\bnone\b/gi, '0')
  const match = /^rgba?\(([^)]*)\)$/.exec(value)
  if (match) {
    const parts = match[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
  }
  const wide = parseWideColour(value)
  if (wide) return wide
  // hsl(), oklch() and oklab(): computed styles keep the form a site defined
  // a colour in (Tailwind 4 sites define theirs in oklch).
  const other = /^(?:hsla?|oklch|oklab)\(([^)]*)\)$/i.exec(value)
  const hex = tryCssColorToHex(other ? value.replace(/\s*\/[^)]*\)$/, ')') : value)
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return null
  const alpha = other ? /\/\s*([\d.]+)(%?)\s*$/.exec(other[1]!) : null
  const n = parseInt(hex.slice(1), 16)
  const a = alpha ? Number(alpha[1]) / (alpha[2] ? 100 : 1) : 1
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
}

const toHex = ([r, g, b]: Rgba): Hex =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}` as Hex

/** The colour as drawn over `under` (white when the page is transparent). */
export function colourOver(value: string, under: Rgba = [255, 255, 255, 1]): Hex | undefined {
  const colour = parseCssColour(value)
  if (!colour) return undefined
  const mix = (i: 0 | 1 | 2) => colour[i] * colour[3] + under[i] * (1 - colour[3])
  return toHex([mix(0), mix(1), mix(2), 1])
}

const firstFamily = (stack: string) =>
  stack
    .split(',')[0]!
    .trim()
    .replace(/^["']|["']$/g, '')

const lengthOf = (value: string) =>
  /^([\d.]+(?:e[+-]?\d+)?)(px|%)$/i.exec(value.trim().split(/\s+/)[0] ?? '')

/** Faces a browser draws in when a page names none of its own. */
const DEFAULT_FACES = new Set(['times new roman', 'times', 'serif', 'sans-serif'])
/** A stack naming only the browser's default face says nothing of the brand. */
const isDefaultStack = (stack: string) =>
  stack
    .split(',')
    .map((name) =>
      name
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase()
    )
    .filter(Boolean)
    .every((name) => DEFAULT_FACES.has(name))

/** The link colour a browser draws in by default: an unstyled logo, not a brand. */
const DEFAULT_LINK = '#0000ee'

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** Words on a button this faint against its fill mean it is not drawn yet (a placeholder). */
const MIN_INK_CONTRAST = 2
const BUTTON_HEIGHT = { min: 24, max: 96 }
/** A fill this far from the page reads as a button, not a tint. */
const STANDS_OFF = 1.5
const BUTTON_MIN_WIDTH = 40

/**
 * The brand's call to action among the page's buttons. Cookie banners,
 * see-through, page-coloured and unreadable fills are left out. A brand
 * colour wins over black, white and grey (a site's header "Sign up" is often
 * black beside a coloured call to action); then a fill that stands off the
 * page over a pale tint; then the colour more buttons share, then the
 * taller, then the first.
 */
export function brandButton(
  candidates: PageCandidate[] | PageButton[],
  under: Rgba
): PageButton | undefined {
  const page = toHex(under)
  const usable = candidates.flatMap((button, index) => {
    if ('overlay' in button && button.overlay) return []
    const colour = parseCssColour(button.bg)
    if (!colour || colour[3] < 0.5) return []
    if ('w' in button && button.w < BUTTON_MIN_WIDTH) return []
    if (button.h < BUTTON_HEIGHT.min || button.h > BUTTON_HEIGHT.max) return []
    const fill = colourOver(button.bg, under)!
    const ink = colourOver(button.fg, parseCssColour(fill)!)
    if (sameColour(fill, page)) return []
    if (ink && contrast(fill, ink) < MIN_INK_CONTRAST) return []
    return [{ button, fill, index }]
  })
  const groups: { fill: Hex; members: typeof usable }[] = []
  for (const entry of usable) {
    const group = groups.find((g) => sameColour(entry.fill, g.fill))
    if (group) group.members.push(entry)
    else groups.push({ fill: entry.fill, members: [entry] })
  }
  const rank = (g: (typeof groups)[number]) => [
    isBrandColour(g.fill) ? 1 : 0,
    // A pale chip barely stands off the page; a call to action does.
    contrast(g.fill, page) >= STANDS_OFF ? 1 : 0,
    g.members.length,
    Math.max(...g.members.map((m) => m.button.h)),
    -g.members[0]!.index,
  ]
  const best = groups.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)]
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!
    return 0
  })[0]
  return best?.members[0]?.button
}

/** The first button outside any cookie banner and of a button's size, for its shape alone. */
function shapeButton(candidates: PageCandidate[] | PageButton[]): PageButton | undefined {
  return candidates.find(
    (button) =>
      !('overlay' in button && button.overlay) &&
      button.h >= BUTTON_HEIGHT.min &&
      button.h <= BUTTON_HEIGHT.max
  )
}

const radiusOf = (radius: RegExpExecArray | null) =>
  radius?.[2] === '%'
    ? { radiusPercent: Number(radius[1]) }
    : radius
      ? { radiusPx: Number(radius[1]) }
      : {}

/** Looser than the mapper's gate: the reader reports, the mapper decides. */
const READ_NEUTRAL_CHROMA = 0.06
const chromaOf = (hex: string) => parseOklch(hexToOklch(hex))?.c ?? 0

/** Fewer words than this on the leading cards says nothing about the site's card colour. */
const CARD_MIN_CHARS = 100
/** The leading cards' fill is the site's card colour when it holds this share of the words on cards. */
const CARD_LEAD_SHARE = 0.6

/**
 * The page's palette as the words show it: the fill of the cards most words
 * sit on (rounded, edged or shadowed boxes, not full-width bands), the most
 * used border, and the most used text colour after the main one. Only
 * near-neutrals of the page's own kind; the mapper decides what reads well.
 *
 * The card colour is the leading cards' alone. When they are the page's own
 * colour, or coloured, or no fill clearly leads, the site has no card colour
 * to take: a chip, a promo box or one tinted tile beside them is not it.
 */
function pageRoles(
  site: PageDarkMeasure,
  under: Rgba,
  text: Hex | undefined
): { card?: Hex; border?: Hex; mutedText?: Hex } {
  const page = toHex(under)
  const opaque = (css: string) => {
    const colour = parseCssColour(css)
    return colour && colour[3] >= 0.95 ? colourOver(css, under) : undefined
  }
  const fits = (hex: string | undefined): hex is Hex =>
    hex !== undefined &&
    !sameColour(hex, page) &&
    chromaOf(hex) < READ_NEUTRAL_CHROMA &&
    isDarkBackground(hex) === isDarkBackground(page)
  const cards = (site.surfaces ?? []).filter(
    (s) => (s.rounded || s.bordered || s.shadowed) && !s.wide
  )
  const words = cards.reduce((sum, s) => sum + s.chars, 0)
  const lead = cards.reduce<(typeof cards)[number] | undefined>(
    (best, s) => (!best || s.chars > best.chars ? s : best),
    undefined
  )
  const leads = lead && lead.chars >= CARD_MIN_CHARS && lead.chars >= CARD_LEAD_SHARE * words
  const fill = leads ? opaque(lead.bg) : undefined
  const card = fits(fill) ? fill : undefined
  const border = (site.borders ?? [])
    .map((b) => opaque(b.color))
    .find((hex): hex is Hex => hex !== undefined && !sameColour(hex, page))
  const mutedText = (site.texts ?? [])
    .map((t) => opaque(t.color))
    .find(
      (hex): hex is Hex =>
        hex !== undefined &&
        !sameColour(hex, page) &&
        (!text || !sameColour(hex, text)) &&
        chromaOf(hex) < READ_NEUTRAL_CHROMA
    )
  return {
    ...(card ? { card } : {}),
    ...(border ? { border } : {}),
    ...(mutedText ? { mutedText } : {}),
  }
}

/**
 * How the page's cards stand off it, each look weighed by the words its
 * cards carry: the page's own tally when it made one, else worked out from
 * its surfaces. There, a card is a box narrower than the page that is
 * rounded, edged or shadowed: with an edge that shows it is bordered, with a shadow that
 * lifts it shadowed, and with neither it is flat when its fill is not the
 * page's. A box with both an edge and a shadow speaks for neither. Nothing
 * when the page has no such cards.
 */
/** A flat card's fill shows against the page at this contrast or more. */
const FLAT_SHOWS = 1.06

function cardLooks(site: PageMeasure, under: Rgba): CardLooks | undefined {
  // A reader that tallied the cards box by box has said it better than the
  // per-colour surfaces can: boxes of one fill often differ in edge and shadow.
  const page = toHex(under)
  if (site.cards) {
    const { border, shadow, flats } = site.cards
    // A fill too near the page to show is no flat card (white on off-white).
    const flat = flats
      ? flats.reduce((sum, { bg, chars }) => {
          const fill = colourOver(bg, under)
          return fill && contrast(fill, page) >= FLAT_SHOWS ? sum + chars : sum
        }, 0)
      : site.cards.flat
    return border + shadow + flat > 0 ? { border, shadow, flat } : undefined
  }
  const looks: CardLooks = { border: 0, shadow: 0, flat: 0 }
  for (const s of site.surfaces ?? []) {
    if (s.wide || !(s.rounded || s.bordered || s.shadowed)) continue
    if (s.bordered && s.shadowed) continue
    if (s.bordered) looks.border += s.chars
    else if (s.shadowed) looks.shadow += s.chars
    else {
      const fill = colourOver(s.bg, under)
      if (fill && !sameColour(fill, page)) looks.flat += s.chars
    }
  }
  return looks.border + looks.shadow + looks.flat > 0 ? looks : undefined
}

/** The dark mode the page shows a visitor whose system is dark, when its page turns dark. */
function darkOf(site: PageMeasure, lightPage: Rgba): BrandRead['dark'] {
  const dark = site.dark
  // The dark read's page by the light one's rule, under the same header:
  // a body the bands cover is not it.
  const colour = dark && !clearColour(dark.bg) ? pageFill(dark, site.header) : null
  if (!dark || !colour) return undefined
  const page = toHex(colour)
  if (isDarkBackground(page) === isDarkBackground(toHex(lightPage))) return undefined
  const text = colourOver(dark.textColor ?? dark.text, colour)
  const button = brandButton(dark.candidates ?? dark.buttons ?? [], colour)
  const buttonFill = button ? colourOver(button.bg, colour) : undefined
  return {
    page: { background: page, ...(text ? { text } : {}), ...pageRoles(dark, colour, text) },
    ...(buttonFill ? { buttonFill } : {}),
  }
}

/** The header bar's fill and link colour, laid over the page. */
function headerOf(header: PageMeasure['header'], under: Rgba): { header?: Hex; headerText?: Hex } {
  const fill = header ? colourOver(header.bg, under) : undefined
  if (!fill) return {}
  const text = header?.text ? colourOver(header.text, parseCssColour(fill) ?? under) : undefined
  return { header: fill, ...(text ? { headerText: text } : {}) }
}

/** The other names the page declares, then its logo's label; the first (`siteName`) left out. */
function declaredNames(site: PageMeasure): string[] | undefined {
  const names = [...(site.names ?? []), site.logo?.label]
    .map((name) => name?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index)
    .filter((name) => name !== site.siteName?.replace(/\s+/g, ' ').trim())
  return names.length > 0 ? names : undefined
}

/** A colour that paints nothing, or cannot be read as one. */
const clearColour = (value: string) => (parseCssColour(value)?.[3] ?? 0) === 0

/** Words this faint on a fill were not drawn on it. */
const READS_ON = 3
/** Dark fills hold nearly all the words on fills before a page that paints nothing is called dark. */
const DARK_FILL_SHARE = 0.9
/** Light fills hold most of the words on fills before a dark body counts as covered. */
const LIGHT_FILL_SHARE = 0.5
/** The band taken for the page holds at least this many characters. */
const PAGE_FILL_MIN_CHARS = 100

/**
 * The fill a visitor sees as the page, or null for the browser's white.
 * That is the body's own colour (or white under a body that paints nothing)
 * whenever the page's words can be read on it. When they cannot, they were
 * drawn on the bands over it, and the page is the wide band that holds the
 * most of them, provided they read on it and the rest of the page agrees:
 *
 * - under a body that paints nothing, a dark band, when dark fills hold
 *   nearly all the words on fills. Light words over a picture beside light
 *   bands prove nothing, and the page stays white.
 * - over a dark body, a light band, when light fills hold most of them.
 * - never against the header: a bar on the body's side of light and dark is
 *   the body's side showing.
 *
 * A body painted light is left alone.
 */
function pageFill(site: PageDarkMeasure, header?: PageMeasure['header']): Rgba | null {
  const body = parseCssColour(site.bg)
  // A see-through body shows what paints behind it; a translucent one is laid over the browser's white.
  const laid = body && body[3] > 0 && body[3] < 1 ? parseCssColour(colourOver(site.bg)!) : body
  const own = !laid || laid[3] === 0 ? null : laid
  const base = toHex(own ?? [255, 255, 255, 1])
  const toDark = !isDarkBackground(base)
  if (toDark && own) return own
  const leading = site.textColor ?? site.text
  const words = colourOver(leading, own ?? undefined)
  if (!words || contrast(words, base) >= READS_ON) return own
  const bar = header ? colourOver(header.bg, own ?? undefined) : undefined
  if (bar && isDarkBackground(bar) !== toDark) return own
  const fills = (site.surfaces ?? []).flatMap((surface) => {
    const colour = parseCssColour(surface.bg)
    return colour && colour[3] >= 0.95 ? [{ ...surface, colour, hex: toHex(colour) }] : []
  })
  const chars = (all: typeof fills) => all.reduce((sum, fill) => sum + fill.chars, 0)
  const side = fills.filter((fill) => isDarkBackground(fill.hex) === toDark)
  if (chars(side) < (toDark ? DARK_FILL_SHARE : LIGHT_FILL_SHARE) * chars(fills)) return own
  const band = side
    .filter((fill) => fill.wide)
    .reduce<(typeof side)[number] | undefined>(
      (best, fill) => (!best || fill.chars > best.chars ? fill : best),
      undefined
    )
  if (!band || band.chars < PAGE_FILL_MIN_CHARS) return own
  const drawn = colourOver(leading, band.colour)
  return drawn && contrast(drawn, band.hex) >= 4.5 ? band.colour : own
}

export function brandReadFromMeasure(site: PageMeasure): BrandRead {
  const page = pageFill(site, site.header)
  const under: Rgba = page ?? [255, 255, 255, 1]
  const pageText = colourOver(site.textColor ?? site.text, under)
  const button = brandButton(site.candidates ?? site.buttons, under)
  // With no button to give the colour, a page-coloured one still shows the shape.
  const shaped = button ?? shapeButton(site.candidates ?? site.buttons)
  const radius = shaped ? lengthOf(shaped.radius) : null
  const headline = site.h1?.font && !isDefaultStack(site.h1.font) ? site.h1.font : undefined
  const bodyStack = [site.textFont, site.bodyFont].find(
    (stack): stack is string => Boolean(stack?.trim()) && !isDefaultStack(stack!)
  )
  // The colour `currentColor` draws an inline logo in, else the one hue its paints share.
  const drawnIn =
    site.logo?.svg !== undefined && site.logo.color ? colourOver(site.logo.color) : undefined
  const logoColour =
    drawnIn && drawnIn !== DEFAULT_LINK && isBrandColour(drawnIn)
      ? drawnIn
      : site.logo?.svg
        ? logoHue(site.logo.svg)
        : undefined
  const looks = cardLooks(site, under)
  const read: BrandRead = {
    title: site.title || undefined,
    siteName: site.siteName?.replace(/\s+/g, ' ').trim() || undefined,
    names: declaredNames(site),
    nameWritten: site.nameWritten?.replace(/\s+/g, ' ').trim() || undefined,
    card: looks ? { looks } : undefined,
    // The rendered page names no other colours: its buttons stand on their own.
    themeColor: brandThemeColour(site.themeColor, { otherColours: false }),
    page: {
      background: page ? toHex(page) : 'transparent',
      text: pageText,
      ...pageRoles(site, under, pageText),
      ...headerOf(site.header, under),
    },
    dark: darkOf(site, under),
    button: button
      ? {
          fill: colourOver(button.bg, under),
          ink: colourOver(button.fg, under),
          heightPx: button.h,
          ...radiusOf(radius),
        }
      : shaped
        ? { heightPx: shaped.h, ...radiusOf(radius) }
        : undefined,
    fonts:
      bodyStack || headline
        ? {
            body: bodyStack ? { family: firstFamily(bodyStack), stack: bodyStack } : undefined,
            headline: headline
              ? {
                  family: firstFamily(headline),
                  stack: headline,
                  ...(site.h1?.minPx ? { minPx: site.h1.minPx } : {}),
                }
              : undefined,
          }
        : undefined,
    logoColour,
    logo: site.logo
      ? {
          widthPx: site.logo.w,
          heightPx: site.logo.h,
          from: site.logo.tag.toLowerCase() === 'svg' ? 'header-svg' : 'header-img',
        }
      : undefined,
  }
  return Object.fromEntries(Object.entries(read).filter(([, v]) => v !== undefined)) as BrandRead
}
