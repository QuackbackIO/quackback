/**
 * Import your brand: what a reader measured on a website (`BrandRead`) turned
 * into the values the portal editor offers (`BrandDraft`): main colour, page
 * and text colours, font, corners, button shape and which logo slot the
 * site's logo fits. Pure, so the mapping is the same whichever reader (static
 * HTML and CSS, or a real browser) produced the read, and can be tested on
 * measured sites without the network.
 */
import { hexToOklch, tryCssColorToHex } from './colors'
import { autoForeground, isDarkBackground, luminance, mutedOf, sameColour } from './colour-setters'
import { parseOklch } from './expand'
import { BRANDING_FONTS, type BrandingFontId } from './fonts'
import type { CustomFontFile, FontExtension } from './font-uploads'
import { fontDisplayName, isSymbolFace, oneFontFamily } from './font-names'
import type { CardStyle, ThemeConfig } from './types'

/** A six-digit lowercase hex colour. */
export type Hex = `#${string}`

export type BrandLogoSource = 'header-svg' | 'header-img' | 'icon'

/** How a font file says it may be used: freely, or as a commercial font the brand must own or license. */
export type SiteFontLicence = 'open' | 'commercial'

/**
 * Why the site's own font files were not copied: a font service serves them,
 * the file forbids it, the site serves only part of its characters, or the
 * file is too large.
 */
export type SiteFontRefusal = 'service' | 'restricted' | 'subset' | 'too-large'

/** A site's own font: its files, or why they were not copied. */
export type SiteFont<File> =
  | { family: string; named?: string; licence: SiteFontLicence; files: File[] }
  | { family: string; named?: string; notCopied: SiteFontRefusal }

/** One font file as read: verified bytes, the regular first. */
export interface SiteFontBytes {
  bytes: Uint8Array
  format: FontExtension
  weight: number
  /** The highest weight a variable font covers. */
  weightTo?: number
}

/** What one reader measured on a site. Every field is optional: readers differ. */
export interface BrandRead {
  title?: string
  /** The name the site declares for itself: `og:site_name`, else its JSON-LD organisation's. */
  siteName?: string
  /** Every other name the site declares (its organisation's, its app's, its logo's label), most trusted first. */
  names?: string[]
  /** The domain's own word as the page's text writes it (`PayParcel`), when it does. */
  nameWritten?: string
  page?: {
    background?: Hex | 'transparent'
    text?: Hex
    scheme?: 'light' | 'dark'
    /** The box most words sit in, the most used border, and the quieter text colour. */
    card?: Hex
    border?: Hex
    mutedText?: Hex
    /** The header bar the logo sits on, when it has a fill of its own, and its links' colour. */
    header?: Hex
    headerText?: Hex
  }
  /** The colours the site shows a visitor whose system is set to dark, when they differ. */
  dark?: {
    page: { background: Hex; text?: Hex; card?: Hex; border?: Hex; mutedText?: Hex }
    buttonFill?: Hex
  }
  /** The page's main button: its fill, ink, height and radius (in px, or as a percentage). */
  button?: {
    fill?: Hex
    ink?: Hex
    radiusPx?: number
    radiusPercent?: number
    heightPx?: number
  }
  card?: {
    radiusPx?: number
    /**
     * How the page's cards stand off it, each look weighed by the words its
     * cards carry: an edge, a shadow, or a fill alone.
     */
    looks?: CardLooks
  }
  fonts?: {
    body?: { family: string; stack: string }
    /**
     * The largest heading's: used when the body is set in the system font.
     * `minPx` is the smallest size the page draws that face at, when measured.
     */
    headline?: { family: string; stack: string; minPx?: number }
  }
  /** The files of the family the text is set in, when the reader could tell (the browser reader). */
  siteFont?: SiteFont<SiteFontBytes>
  /** The files of the family the largest heading is set in, when it is another family (the browser reader). */
  siteHeadingFont?: SiteFont<SiteFontBytes>
  /** The logo as drawn. `svg` is sanitised markup; `raster` verified image bytes. */
  logo?: {
    svg?: string
    raster?: { bytes: Uint8Array; mime: string }
    widthPx: number
    heightPx: number
    from: BrandLogoSource
    /**
     * The inks the logo was drawn in, each with the share of its pixels, when
     * the reader drew it and counted (the browser reader).
     */
    inks?: { color: Hex; share: number; box?: number[]; plate?: boolean }[]
  }
  /**
   * The site's own dark-mode logo, when the reader found one (the browser
   * reader): the logo it shows a dark system (`scheme`), a picture's dark
   * source (`picture`), or a twin the page marks for dark mode (`pair`).
   * Verified as the logo is.
   */
  darkLogo?: NonNullable<BrandRead['logo']> & { how: 'scheme' | 'picture' | 'pair' }
  /**
   * The site's app icon (apple-touch or manifest icon), square and large
   * enough to stand as the workspace icon. Verified image bytes.
   */
  icon?: { raster: { bytes: Uint8Array; mime: string }; widthPx: number; heightPx: number }
  themeColor?: Hex
  /** The local versions a country or language picker homepage names (hreflang). */
  localVersions?: { lang: string; url: string }[]
  /** The colour a single-colour inline logo is drawn in. */
  logoColour?: Hex
  /** Colour candidates, the larger share the stronger. */
  palette?: { hex: Hex; share: number }[]
}

/** The words on a page's cards, by how the card stands off the page. */
export type CardLooks = Record<CardStyle, number>

export type BrandImportMissing = 'logo' | 'icon' | 'colour' | 'page' | 'font' | 'shape'
export type BrandLogoKind = 'wide' | 'square'
export type BrandButtonShape = NonNullable<ThemeConfig['buttonShape']>

/** The page's neutrals, as theme tokens: what the editor would otherwise work out from the page. */
export interface BrandTokens {
  card?: Hex
  border?: Hex
  mutedForeground?: Hex
  /** The header bar's colour, when it is not the page's. */
  header?: Hex
}

/** A light site's own dark mode, as the portal's dark theme. With one, visitors choose light or dark. */
export interface BrandDarkMode extends BrandTokens {
  background: Hex
  foreground?: Hex
  primary?: Hex
}

/** The editor values a read gives. Absent values leave the draft as it is. */
export interface BrandDraft {
  primary?: Hex
  background?: Hex
  /** Set only when the site's text colour differs from the automatic one and reads well. */
  text?: Hex
  scheme?: 'light' | 'dark'
  /** `site` is the site's own family; `id` the portal font used; `exact` when they are the same. */
  font: { site?: string; id: BrandingFontId; exact: boolean }
  /** Corner radius in rem, one of `CORNER_STOPS`. */
  radius?: number
  buttonShape?: BrandButtonShape
  /** The button's own radius in px, when its corners are not a pill. */
  buttonPx?: number
  /**
   * The family the site's headings are set in, when it is not the text
   * font's: `id` is the portal font it is, when the portal has it. `display`
   * when the site draws it only large: a face for page headings, not for a
   * post's or a card's title.
   */
  headings?: { site: string; id?: BrandingFontId; display?: boolean }
  /** How the site's cards stand off the page, when its main cards clearly agree. */
  cardStyle?: CardStyle
  logo?: { kind: BrandLogoKind }
  /** The site's card, border and quieter text, for the theme on the site's own side. */
  tokens?: BrandTokens
  /** A light site's dark mode, for the portal's dark theme. */
  darkMode?: BrandDarkMode
  missing: BrandImportMissing[]
}

/** What `importBrandFn` returns: the draft values, the site, and the staged logo. */
export interface BrandImport extends Omit<BrandDraft, 'logo'> {
  host: string
  reader: 'static' | 'browser'
  /**
   * The site's logo (its header artwork), uploaded but not saved to any
   * setting. Its key goes to publish as `logo.wideKey`. `kind` says whether
   * it is wide (a wordmark or lockup) or square (a mark alone).
   */
  logo?: { kind: BrandLogoKind; stagedKey: string; url: string }
  /**
   * The site's own dark-mode logo, when it has one, uploaded but not saved:
   * it goes to publish as `logo.darkKey`. Never one made by recolouring.
   */
  logoDark?: { stagedKey: string; url: string }
  /**
   * The site's icon, with a favicon copy of it, uploaded but not saved. They
   * go to publish together as `logo.icon`.
   */
  icon?: { key: string; faviconKey: string; url: string }
  /**
   * The site has an icon, but changing the workspace icon needs
   * settings.manage, which the caller lacks: it was not uploaded.
   */
  iconBlocked?: 'permission'
  /**
   * The site's own font, its files uploaded but not saved (they go to publish
   * as the theme's `customFont`), or why they were not copied. Absent when the
   * portal has the same font, or the reader could not tell.
   */
  siteFont?: SiteFont<CustomFontFile>
  /**
   * The site's own headings font, likewise (the theme's `customHeadingFont`),
   * or why it was not copied. Absent when the headings are set in the text
   * font or a font the portal has.
   */
  siteHeadingFont?: SiteFont<CustomFontFile>
  /** The name the site goes by: what it declares, else the name in its title. */
  siteName?: string
  /**
   * The portal is on the imported site's own domain (a custom domain under
   * the same registrable domain), so the brand assets start confirmed.
   */
  portalOnSite?: boolean
}

/** The brand assets an import holds until the person confirms them. */
export type BrandAsset = 'logo' | 'icon' | 'font' | 'headingFont'

/** Why an import read nothing. Each comes with a message written for the person. */
export type ImportBrandRefusalCode =
  | 'INVALID_WEBSITE'
  | 'RATE_LIMITED'
  | 'ROBOTS_DISALLOWED'
  | 'SITE_UNREACHABLE'
  | 'SITE_BLOCKED'
  | 'SITE_ERROR_PAGE'
  | 'SITE_PICKER'

/** The name Import's reader goes by, to every site it reads: what a site's owner allows. */
export const BRAND_READER_NAME = 'QuackbackBrandReader'

/**
 * The site answered, but not with its own page, so nothing was imported:
 * what it showed instead, for the editor to say so in its own words.
 */
export interface SiteNotRead {
  /** An error or maintenance page or a queue, a bot check, or a country picker. */
  reason: 'error' | 'bot' | 'picker'
  host: string
  /** A picker's own addresses to import instead, at most three. */
  candidates: string[]
}

/**
 * What `importBrandFn` returns. Refusals come back as values (a thrown error
 * reaches the browser without its code), each with a message to show as is.
 */
export type ImportBrandResult =
  | { ok: true; brand: BrandImport }
  | { ok: false; code: ImportBrandRefusalCode; message: string; notRead?: SiteNotRead }

/** The corner radius choices, in rem. */
export const CORNER_STOPS = [0, 0.25, 0.5, 1] as const
const SOFT_CORNERS = 0.5
/** A logo this much wider than tall is a wordmark, for the wide header slot. */
const WIDE_ASPECT = 2.2
/** Below this OKLCH chroma a colour reads as grey rather than a brand colour. */
const MIN_BRAND_CHROMA = 0.05
const READABLE_CONTRAST = 4.5

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const chroma = (hex: string) => parseOklch(hexToOklch(hex))?.c ?? 0

/**
 * A colour that can lead a brand: saturated, neither a pale tint nor nearly
 * black. Black, white, greys and pastel chips are not brand colours.
 */
export function isBrandColour(hex: string): boolean {
  const lch = parseOklch(hexToOklch(hex))
  if (!lch || lch.c < MIN_BRAND_CHROMA) return false
  return lch.l >= 0.25 && lch.l <= 0.97 && !(lch.l > 0.85 && lch.c < 0.13)
}

/** Paints within this many degrees of hue read as one colour (a logo's shades of orange). */
const SAME_HUE = 40
/**
 * Share of a logo's brand-coloured paints its main hue must hold to speak for
 * the brand: IKEA's blue holds two of three (the yellow oval the third); a
 * logo of four or five hues holds a fifth or a quarter.
 */
const ONE_HUE_SHARE = 0.6

/**
 * The colour an SVG logo is drawn in, when its brand-coloured paints mostly
 * share one hue: the most used of them. A logo of many hues names no colour.
 */
export function logoHue(svg: string): Hex | undefined {
  const paints = [
    ...svg.matchAll(
      /(?:fill|stroke)\s*[=:]\s*["']?\s*((?:rgba?|hsla?|oklch|oklab)\([^)]*\)|#[\da-f]{6}\b|#[\da-f]{3}\b)/gi
    ),
  ]
    .map((m) => tryCssColorToHex(m[1]!.replace(/\s*\/[^)]*\)$/, ')')) as Hex | null)
    .filter((hex): hex is Hex => hex !== null && isBrandColour(hex))
  if (paints.length === 0) return undefined
  const hue = (hex: string) => parseOklch(hexToOklch(hex))?.h ?? 0
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
  const counts = new Map<Hex, number>()
  for (const hex of paints) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  const [lead] = [...counts].sort((a, b) => b[1] - a[1])[0]!
  const sharing = paints.filter((hex) => apart(hue(hex), hue(lead)) <= SAME_HUE).length
  return sharing / paints.length >= ONE_HUE_SHARE ? lead : undefined
}

/** The contrast a control needs with what is around it (WCAG 1.4.11). */
const BUTTON_SHOWS = 3

/**
 * The main button's fill when it is a brand colour; else the theme or logo
 * colour when one is (a site whose buttons are black can still be pink);
 * else the black or white button; else the most saturated of the strongest
 * palette colours. Never the page colour itself; nothing when no candidate
 * is sure enough.
 */
function primaryOf(read: BrandRead, background: Hex | undefined): Hex | undefined {
  const isPage = (hex: string) => background !== undefined && sameColour(hex, background)
  const button = read.button?.fill && !isPage(read.button.fill) ? read.button.fill : undefined
  if (button && isBrandColour(button)) return button
  // A black, white or grey button leads only when it shows on the page as a
  // control must: a pale grey one on white is a quiet button, not the brand's.
  const fill =
    button && contrast(button, background ?? '#ffffff') >= BUTTON_SHOWS ? button : undefined
  // The logo's colour: as drawn on the page, else the hue its SVG is mostly drawn in.
  const logoColour = read.logoColour ?? (read.logo?.svg ? logoHue(read.logo.svg) : undefined)
  const signal = [read.themeColor, logoColour].find(
    (hex): hex is Hex => hex !== undefined && !isPage(hex) && isBrandColour(hex)
  )
  if (signal) return signal
  if (fill) return fill
  // A black, white or grey theme colour is held to the same test: on a dark
  // site it is often the page's own shade, set to tint the browser's bar.
  if (
    read.themeColor &&
    !isPage(read.themeColor) &&
    contrast(read.themeColor, background ?? '#ffffff') >= BUTTON_SHOWS
  )
    return read.themeColor
  const leaders = (read.palette ?? []).filter(
    (entry) => isBrandColour(entry.hex) && !isPage(entry.hex)
  )
  const top = Math.max(...leaders.map((entry) => entry.share))
  return leaders
    .filter((entry) => entry.share >= top - 1e-9)
    .sort((a, b) => chroma(b.hex) - chroma(a.hex))[0]?.hex
}

const nearestStop = (px: number) =>
  CORNER_STOPS.reduce((best, stop) =>
    Math.abs(stop * 16 - px) < Math.abs(best * 16 - px) ? stop : best
  )

function shapeOf(read: BrandRead): Pick<BrandDraft, 'radius' | 'buttonShape' | 'buttonPx'> {
  const button = read.button
  let buttonShape: BrandButtonShape | undefined
  if (button?.radiusPercent !== undefined) {
    buttonShape = button.radiusPercent >= 50 ? 'pill' : 'corners'
  } else if (button?.radiusPx !== undefined) {
    const half = button.heightPx !== undefined ? button.heightPx / 2 - 1 : 999
    buttonShape = button.radiusPx >= half ? 'pill' : 'corners'
  }
  const buttonPx = buttonShape === 'corners' ? button?.radiusPx : undefined
  // Corners never come from a pill button: its radius says nothing about cards.
  let radius: number | undefined
  if (read.card?.radiusPx !== undefined) radius = nearestStop(read.card.radiusPx)
  else if (buttonPx !== undefined) radius = nearestStop(buttonPx)
  else if (buttonShape) radius = SOFT_CORNERS
  return { radius, buttonShape, buttonPx }
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Generic and system family names: never a brand's face. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'math',
  'fangsong',
  'emoji',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
])
const SERIF_FALLBACKS = new Set(['serif', 'ui-serif', 'georgia', 'times', 'times new roman'])
const MONO_FALLBACKS = new Set(['monospace', 'ui-monospace'])

/** Each family's face by class, for a face the portal does not offer. */
const NEAREST_BY_CLASS: ReadonlyArray<readonly [RegExp, BrandingFontId]> = [
  [/round|quicksand/, 'nunito'],
  [/mono|menlo|monaco|consolas|courier|jetbrains/, 'jetbrains'],
  // Grotesks and neo-grotesks, and a company's own cut of Inter.
  [
    /s[oö]hne|gt america|founders grotesk|calibre|aeonik|suisse|haas|helvetica|akzidenz|graphik|grotesk|grotesque|franklin gothic|news gothic|trade gothic|univers|sf pro|san francisco|segoe|[a-z]{4,} ?inter$/,
    'inter',
  ],
  [/\bdin\b|roboto flex/, 'roboto'],
  // Geometrics.
  [
    /futura|avant[ -]?garde|larsseit|gilroy|brandon|gotham|montserrat|tt norms|campton|circular|cereal|walsheim|apercu|euclid|proxima nova|avenir|museo sans|sofia pro|\bcera\b/,
    'dm-sans',
  ],
  // Humanists.
  [
    /frutiger|myriad|gill sans|optima|lucida|source sans|fira sans|verdana|tahoma|calibri|^noto (?!serif|mono|color|emoji)/,
    'open-sans',
  ],
  // Display serifs, then slabs, then text serifs.
  [/bodoni|didot|editorial new|canela|gt super|recoleta|cooper|playfair/, 'playfair'],
  [/slab|rockwell|clarendon|archer|sentinel/, 'merriweather'],
  [
    /tiempos|publico|freight text|chronicle|georgia|times|garamond|caslon|baskerville|minion|charter/,
    'lora',
  ],
]

const unquote = (name: string) =>
  name
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim()

/** The names in a font-family value, unquoted, in order. */
function familiesOf(stack: string): string[] {
  return (stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map(unquote).filter(Boolean)
}

/** A family's name to compare by: as a person reads it, so one weight's file or a build's hash is the family. */
const comparable = (name: string) =>
  fontDisplayName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Whether two names are one family, however each is spelt (`adobe-clean` is Adobe Clean). */
export const sameFontFamily = (a: string, b: string) => comparable(a) === comparable(b)

/** The family as a person would read it: `sohne-var` is Sohne, `MonzoSansText` Monzo Sans Text. */
const displayName = fontDisplayName

/** Each portal font's own family names, comparable. The system font has none. */
const PORTAL_FONT_NAMES: ReadonlyArray<readonly [BrandingFontId, string[]]> = BRANDING_FONTS.map(
  (font) => {
    const first = familiesOf(font.value)[0]
    const names = first && !GENERIC_FAMILIES.has(first.toLowerCase()) ? [comparable(first)] : []
    // Geist is published as "Geist Sans"; sites name it Geist.
    if (font.id === 'geist') names.push('geist')
    return [font.id, names] as const
  }
)

function portalFont(name: string): BrandingFontId | undefined {
  const key = comparable(name)
  return PORTAL_FONT_NAMES.find(([, names]) => names.includes(key))?.[0]
}

const isGeneric = (name: string) => GENERIC_FAMILIES.has(name.toLowerCase())

/** Names that start the operating system's own font stack. */
const SYSTEM_STACK = new Set([
  '-apple-system',
  'blinkmacsystemfont',
  'system-ui',
  'ui-sans-serif',
  'segoe ui',
])
const isSystem = (name: string) => SYSTEM_STACK.has(name.toLowerCase())

/**
 * The brand's family in a stack and the fallbacks the site chose after it,
 * or null for a stack that is the system font. The system stack a site
 * appends (`-apple-system, "Segoe UI", Roboto`) is the operating system's
 * faces, not a choice, so its names are no fallback.
 */
function siteFamily(stack: string): { family: string; rest: string[]; all: string[] } | null {
  // Faces a stack lists for currency signs, emoji, flags or icons are not its text's.
  const all = familiesOf(stack).filter((name) => !isSymbolFace(name))
  if (all[0] && isSystem(all[0])) return null
  const index = all.findIndex((name) => !isGeneric(name))
  if (index === -1) return null
  const after = all.slice(index + 1)
  const system = after.findIndex(isSystem)
  return { family: all[index], rest: system === -1 ? after : after.slice(0, system), all }
}

/**
 * The family as its copied file spells it, when that is the same family: a
 * stylesheet often runs the words together (`Abcgintonorthwind`) or a weight
 * into the name (`northwindregular`) where the file's own name is plain.
 * `named` is what the stylesheet calls a font whose file names it otherwise.
 */
const spelling = (family: string, ...copied: BrandRead['siteFont'][]) =>
  copied.find(
    (font) =>
      font &&
      (sameFontFamily(font.family, family) ||
        (font.named !== undefined && sameFontFamily(font.named, family)))
  )?.family ?? family

function fontOf(read: BrandRead): BrandDraft['font'] | null {
  const stacks = [read.fonts?.body?.stack, read.fonts?.headline?.stack].filter(
    (stack): stack is string => Boolean(stack?.trim())
  )
  if (stacks.length === 0) return null
  const found = stacks.map(siteFamily).find((entry) => entry !== null)
  // Body and headline both set in the system font: the portal has that too.
  if (!found) return { id: 'system', exact: true }

  // The text font may be the headings' (a body set in the system font): either file may spell it.
  const site = displayName(spelling(found.family, read.siteFont, read.siteHeadingFont))
  const exact = portalFont(found.family)
  if (exact) return { site, id: exact, exact: true }
  for (const name of found.rest) {
    const later = isGeneric(name) ? undefined : portalFont(name)
    if (later) return { site, id: later, exact: false }
  }
  // The face itself, then the one the site names right after it (Circular
  // after a brand's own cut of it); later names are locale fallbacks.
  for (const name of [found.family, ...found.rest.slice(0, 1)]) {
    const lower = name.toLowerCase()
    const byClass = NEAREST_BY_CLASS.find(([pattern]) => pattern.test(lower))?.[1]
    if (byClass) return { site, id: byClass, exact: false }
  }
  const names = found.all.map((name) => name.toLowerCase())
  if (names.some((name) => MONO_FALLBACKS.has(name))) return { site, id: 'jetbrains', exact: false }
  if (names.some((name) => SERIF_FALLBACKS.has(name))) return { site, id: 'lora', exact: false }
  return { site, id: 'inter', exact: false }
}

/**
 * The family the site's headings are set in, when they have one of their
 * own: not the text font's family, not another cut of it (Monzo Sans Display
 * over Monzo Sans Text), and not the system font. `id` when the portal has
 * that font and can load it.
 */
/** A headings face never drawn smaller than this is a display face: set large only. */
const DISPLAY_FACE_MIN_PX = 24

export function headingsOf(
  read: BrandRead,
  text: BrandDraft['font'] | null
): BrandDraft['headings'] {
  const stack = read.fonts?.headline?.stack
  const found = stack?.trim() ? siteFamily(stack) : null
  if (!found || !text) return undefined
  // Headings set in the text's family are named by the text font's file.
  const site = displayName(spelling(found.family, read.siteHeadingFont, read.siteFont))
  const id = portalFont(found.family)
  // The text font, however each is named: the same family, the same portal font, or one family in two cuts.
  if (text.site && (sameFontFamily(site, text.site) || oneFontFamily(site, text.site)))
    return undefined
  if (id && id === text.id && text.exact) return undefined
  // A site with no text font of its own had its headings' taken for the text.
  if (!read.fonts?.body?.stack?.trim() || !siteFamily(read.fonts.body.stack)) return undefined
  const minPx = read.fonts?.headline?.minPx
  const display = minPx !== undefined && minPx >= DISPLAY_FACE_MIN_PX ? { display: true } : {}
  return id ? { site, id, ...display } : { site, ...display }
}

/** A page's cards agree on a look when this share of their words sit on cards of that look. */
const CARD_LOOK_SHARE = 0.7
/** Fewer words on cards than this says nothing about the site's cards. */
const CARD_LOOK_MIN_CHARS = 100

/**
 * The card style a page's cards clearly share, or nothing: too few words on
 * cards, or cards of mixed looks, leave the portal's as it is.
 */
export function cardStyleOf(looks: CardLooks | undefined): CardStyle | undefined {
  if (!looks) return undefined
  const entries = (Object.entries(looks) as [CardStyle, number][]).filter(
    ([, chars]) => Number.isFinite(chars) && chars > 0
  )
  const total = entries.reduce((sum, [, chars]) => sum + chars, 0)
  if (total < CARD_LOOK_MIN_CHARS) return undefined
  const [style, chars] = entries.sort((a, b) => b[1] - a[1])[0]!
  return chars / total >= CARD_LOOK_SHARE ? style : undefined
}

// ---------------------------------------------------------------------------

function logoKindOf(logo: NonNullable<BrandRead['logo']>): BrandLogoKind {
  if (logo.from === 'icon' || logo.heightPx <= 0) return 'square'
  return logo.widthPx / logo.heightPx >= WIDE_ASPECT ? 'wide' : 'square'
}

// ---------------------------------------------------------------------------
// The page palette
// ---------------------------------------------------------------------------

/**
 * A neutral is a grey, or one barely tinted. A surface may only be faintly
 * warm or cool (paper); a pale pink chip is a colour. Text and borders, being
 * darker, carry a stronger tint as a slate or a warm grey.
 */
const SURFACE_CHROMA = 0.025
const INK_CHROMA = 0.045
/** A card this close to the page reads as the page's own surface. */
const CARD_MAX_CONTRAST = 1.25
/** A border fainter than this disappears; stronger reads as a rule, not an edge. */
const BORDER_CONTRAST = { min: 1.15, max: 3 }
/**
 * Quieter text sits clearly below the main text: at most this share of the
 * main text's contrast, and no stronger than this. A second near-black is a
 * second body colour, not a quiet one.
 */
const QUIET_SHARE = 0.7
const QUIET_MAX_CONTRAST = 10
/** A header bar this close to the page is the page. */
const HEADER_STANDS_OFF = 1.15
/** A dark mode's text is taken only near white; a grey there is its secondary text. */
const DARK_TEXT_CONTRAST = 10
/**
 * The contrast a page colour must give its own text. Below it the page is a
 * mid-tone: black and white both read weakly on it, and text in a colour of
 * its own (a tag, a vote count) cannot be made to read at all.
 */
const PAGE_TEXT_CONTRAST = 7
/** A dark mode's words must still show on its dark page, or it is no dark mode. */
const DARK_MODE_TEXT_CONTRAST = 3
/** A dark mode's main colour must show on its dark page. */
const DARK_PRIMARY_CONTRAST = 3

/**
 * The site's card, border, quieter text and header bar as tokens, each kept only when it
 * reads well on `background` beside `foreground`: a card the same kind of
 * shade as the page with the text still readable on it, a visible but quiet
 * border, quieter text that is still readable. Colours (a pink chip) are
 * never neutrals. Nothing kept, nothing returned.
 */
function tokensOf(
  roles: { card?: Hex; border?: Hex; mutedText?: Hex; header?: Hex },
  background: Hex,
  foreground: string
): BrandTokens | undefined {
  const tokens: BrandTokens = {}
  const { card, border, mutedText } = roles
  if (
    card &&
    chroma(card) < SURFACE_CHROMA &&
    !sameColour(card, background) &&
    isDarkBackground(card) === isDarkBackground(background) &&
    contrast(card, background) <= CARD_MAX_CONTRAST &&
    contrast(foreground, card) >= READABLE_CONTRAST
  )
    tokens.card = card
  if (
    border &&
    chroma(border) < INK_CHROMA &&
    contrast(border, background) >= BORDER_CONTRAST.min &&
    contrast(border, background) <= BORDER_CONTRAST.max
  )
    tokens.border = border
  if (
    mutedText &&
    chroma(mutedText) < INK_CHROMA &&
    !sameColour(mutedText, foreground) &&
    contrast(mutedText, background) >= READABLE_CONTRAST &&
    contrast(mutedText, tokens.card ?? background) >= READABLE_CONTRAST &&
    // Quiet text also sits on the quiet fill (an avatar's initials, a chip).
    contrast(mutedText, mutedOf(background)) >= READABLE_CONTRAST &&
    contrast(mutedText, background) <=
      Math.min(QUIET_MAX_CONTRAST, QUIET_SHARE * contrast(foreground, background))
  )
    tokens.mutedForeground = mutedText
  // The portal works out readable text and tabs for any bar, so only a bar
  // that is the page (a shade off white) is dropped.
  if (roles.header && contrast(roles.header, background) >= HEADER_STANDS_OFF)
    tokens.header = roles.header
  return Object.keys(tokens).length > 0 ? tokens : undefined
}

/**
 * A light site's own dark mode as the portal's dark theme, or nothing when it
 * has none. A site has one only when a dark system really changes its page:
 * the page turns dark and its words still show there. A dark-scheme
 * rule that touches less (a banner, a code block, the page alone under words
 * left dark) is not a dark mode, and the portal stays light.
 */
function darkModeOf(read: BrandRead, background: Hex | undefined): BrandDarkMode | undefined {
  const dark = read.dark
  if (!dark || !background || isDarkBackground(background)) return undefined
  const page = dark.page.background
  if (!isDarkBackground(page)) return undefined
  if (!dark.page.text || contrast(dark.page.text, page) < DARK_MODE_TEXT_CONTRAST) return undefined
  const text = contrast(dark.page.text, page) >= DARK_TEXT_CONTRAST ? dark.page.text : undefined
  const fill = dark.buttonFill
  const primary =
    fill && isBrandColour(fill) && contrast(fill, page) >= DARK_PRIMARY_CONTRAST ? fill : undefined
  return {
    background: page,
    ...(text ? { foreground: text } : {}),
    ...(primary ? { primary } : {}),
    ...tokensOf(dark.page, page, text ?? autoForeground(page)),
  }
}

/** The editor values a site's read gives, and what it could not give. */
export function mapBrandRead(read: BrandRead): BrandDraft {
  const missing: BrandImportMissing[] = []
  const logo = read.logo ? { kind: logoKindOf(read.logo) } : undefined
  if (!logo) missing.push('logo')

  const page = read.page?.background
  const paper: Hex | undefined = page === 'transparent' ? '#ffffff' : page
  // A mid-tone carries no text well (a splash screen's blue, a brand band
  // behind the content): it is not taken for the page.
  const background =
    paper && contrast(autoForeground(paper), paper) >= PAGE_TEXT_CONTRAST ? paper : undefined

  const primary = primaryOf(read, background)
  if (!primary) missing.push('colour')
  let text: Hex | undefined
  if (!background) missing.push('page')
  else {
    const siteText = read.page?.text
    if (
      siteText &&
      contrast(siteText, background) >= READABLE_CONTRAST &&
      // The text also sits on the quiet fill (the active tab, a chip).
      contrast(siteText, mutedOf(background)) >= READABLE_CONTRAST &&
      !sameColour(siteText, autoForeground(background))
    )
      text = siteText
  }

  const tokens = background
    ? tokensOf(read.page ?? {}, background, text ?? autoForeground(background))
    : undefined
  const darkMode = darkModeOf(read, background)

  const font = fontOf(read)
  if (!font) missing.push('font')

  const shape = shapeOf(read)
  if (!shape.buttonShape && shape.radius === undefined) missing.push('shape')
  const headings = headingsOf(read, font)
  const cardStyle = cardStyleOf(read.card?.looks)

  return {
    primary,
    background,
    text,
    scheme: background ? (isDarkBackground(background) ? 'dark' : 'light') : undefined,
    font: font ?? { id: 'inter', exact: false },
    ...shape,
    ...(headings ? { headings } : {}),
    ...(cardStyle ? { cardStyle } : {}),
    logo,
    ...(tokens ? { tokens } : {}),
    ...(darkMode ? { darkMode } : {}),
    missing,
  }
}
