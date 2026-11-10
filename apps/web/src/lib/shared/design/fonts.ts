import { DEFAULT_FONT_SANS } from '@/lib/shared/theme/expand'
import type { PortalDesign } from './schema'
import type { BUNDLED_FONT_IDS } from './options'

export type BundledFontId = (typeof BUNDLED_FONT_IDS)[number]
type DesignFont = PortalDesign['brand']['fonts']['body']
type UploadedFont = Extract<DesignFont, { kind: 'uploaded' }>

/** The font files a brand may upload: each format's type, and how large one may be. */
export const FONT_FORMATS = {
  woff2: { type: 'font/woff2', format: 'woff2', maxBytes: 400 * 1024 },
  woff: { type: 'font/woff', format: 'woff', maxBytes: 600 * 1024 },
  ttf: { type: 'font/ttf', format: 'truetype', maxBytes: 1024 * 1024 },
  otf: { type: 'font/otf', format: 'opentype', maxBytes: 1024 * 1024 },
} as const
export type FontExtension = keyof typeof FONT_FORMATS

/** Uploaded fonts: woff2, woff, ttf or otf files, six to a family, kept under `fonts/`. */
export const FONT_UPLOADS = {
  maxFiles: 6,
  prefix: 'fonts',
  accept: '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf',
} as const

/** A font file's format, from its name, or null when it is not one the portal takes. */
export function fontExtension(name: string): FontExtension | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  return ext && Object.hasOwn(FONT_FORMATS, ext) ? (ext as FontExtension) : null
}

/** The format a font file's content type names, or null. */
export function fontTypeExtension(type: string): FontExtension | null {
  const found = Object.entries(FONT_FORMATS).find(([, f]) => f.type === type)
  return found ? (found[0] as FontExtension) : null
}

/** How a file size reads in a refusal: 400 KB, 1 MB. */
export const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${Math.round(bytes / 1024)} KB`

/** Where the portal loads an uploaded font file from: its own origin. */
export const uploadedFontUrl = (key: string) => `/api/storage/${key}`

/** An uploaded family's file nearest a weight, upright where it has one. */
export function uploadedFontFile(
  font: UploadedFont,
  weight: number
): UploadedFont['files'][number] {
  const upright = font.files.filter((file) => file.style === 'normal')
  const files = upright.length > 0 ? upright : font.files
  return files.reduce((best, file) =>
    Math.abs(file.weight - weight) < Math.abs(best.weight - weight) ? file : best
  )
}

/** The `@font-face` rules for a design's uploaded families, one per file. */
export function uploadedFontFaces(doc: PortalDesign): string {
  const rules = new Set<string>()
  const { body, heading, display } = doc.brand.fonts
  for (const font of [body, heading, display]) {
    if (font?.kind !== 'uploaded') continue
    for (const file of font.files) {
      rules.add(
        `@font-face { font-family: "${font.family}"; src: url("${uploadedFontUrl(file.key)}") format("${FONT_FORMATS[fontExtension(file.key) ?? 'woff2'].format}"); font-weight: ${file.weight}; font-style: ${file.style}; font-display: swap; }`
      )
    }
  }
  return [...rules].join(' ')
}

export interface BundledFont {
  label: string
  category: 'sans' | 'display' | 'serif' | 'slab' | 'rounded' | 'mono' | 'system'
  /** The CSS font-family stack. Today's families keep the stack they have always had. */
  stack: string
  /** The weights its stylesheet loads (`src/styles/fonts/*.css`). */
  weights: readonly number[]
}

const SANS = 'ui-sans-serif, system-ui, sans-serif'
const SERIF = 'ui-serif, Georgia, serif'
const STANDARD = [400, 500, 600, 700] as const

/**
 * The design engine's one font registry: every family a design can use
 * without uploading files. Each loads only when a design uses it.
 */
export const BUNDLED_FONTS: Record<BundledFontId, BundledFont> = {
  inter: {
    label: 'Inter',
    category: 'sans',
    stack: DEFAULT_FONT_SANS,
    // A variable face (100 to 900), so light display type is drawn, not faked.
    weights: [300, 400, 500, 600, 700, 800],
  },
  system: {
    label: 'System UI',
    category: 'system',
    stack: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    weights: [400, 500, 600, 700, 800],
  },
  roboto: {
    label: 'Roboto',
    category: 'sans',
    stack: `"Roboto", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'open-sans': {
    label: 'Open Sans',
    category: 'sans',
    stack: `"Open Sans", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  lato: { label: 'Lato', category: 'sans', stack: `"Lato", ${SANS}`, weights: [300, 400, 700] },
  nunito: {
    label: 'Nunito',
    category: 'sans',
    stack: `"Nunito", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  poppins: {
    label: 'Poppins',
    category: 'sans',
    stack: `"Poppins", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'dm-sans': {
    label: 'DM Sans',
    category: 'sans',
    stack: `"DM Sans", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  jakarta: {
    label: 'Plus Jakarta Sans',
    category: 'sans',
    stack: `"Plus Jakarta Sans", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  // The package publishes Geist as the "Geist Sans" family.
  geist: {
    label: 'Geist',
    category: 'sans',
    stack: `"Geist Sans", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  manrope: {
    label: 'Manrope',
    category: 'sans',
    stack: `"Manrope", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'space-grotesk': {
    label: 'Space Grotesk',
    category: 'sans',
    stack: `"Space Grotesk", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'ibm-plex-sans': {
    label: 'IBM Plex Sans',
    category: 'sans',
    stack: `"IBM Plex Sans", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    category: 'sans',
    stack: `"Bricolage Grotesque", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  playfair: {
    label: 'Playfair Display',
    category: 'serif',
    stack: `"Playfair Display", ${SERIF}`,
    weights: STANDARD,
  },
  merriweather: {
    label: 'Merriweather',
    category: 'serif',
    stack: `"Merriweather", ${SERIF}`,
    weights: [300, ...STANDARD],
  },
  lora: { label: 'Lora', category: 'serif', stack: `"Lora", ${SERIF}`, weights: STANDARD },
  fraunces: {
    label: 'Fraunces',
    category: 'serif',
    stack: `"Fraunces", ${SERIF}`,
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  'inter-tight': {
    label: 'Inter Tight',
    category: 'sans',
    stack: `"Inter Tight", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  sora: {
    label: 'Sora',
    category: 'sans',
    stack: `"Sora", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  outfit: {
    label: 'Outfit',
    category: 'sans',
    stack: `"Outfit", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  figtree: {
    label: 'Figtree',
    category: 'sans',
    stack: `"Figtree", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'work-sans': {
    label: 'Work Sans',
    category: 'sans',
    stack: `"Work Sans", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'instrument-sans': {
    label: 'Instrument Sans',
    category: 'sans',
    stack: `"Instrument Sans", ${SANS}`,
    weights: STANDARD,
  },
  'noto-sans': {
    label: 'Noto Sans',
    category: 'sans',
    stack: `"Noto Sans", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  rubik: {
    label: 'Rubik',
    category: 'sans',
    stack: `"Rubik", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'mona-sans': {
    label: 'Mona Sans',
    category: 'sans',
    stack: `"Mona Sans", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'hanken-grotesk': {
    label: 'Hanken Grotesk',
    category: 'sans',
    stack: `"Hanken Grotesk", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  karla: {
    label: 'Karla',
    category: 'sans',
    stack: `"Karla", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'libre-franklin': {
    label: 'Libre Franklin',
    category: 'sans',
    stack: `"Libre Franklin", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  'barlow-condensed': {
    label: 'Barlow Condensed',
    category: 'sans',
    stack: `"Barlow Condensed", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  oswald: {
    label: 'Oswald',
    category: 'sans',
    stack: `"Oswald", ${SANS}`,
    weights: [300, ...STANDARD],
  },
  'source-serif': {
    label: 'Source Serif 4',
    category: 'serif',
    stack: `"Source Serif 4", ${SERIF}`,
    weights: [300, 400, 500, 600, 700, 800],
  },
  archivo: {
    label: 'Archivo',
    category: 'sans',
    stack: `"Archivo", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  unbounded: {
    label: 'Unbounded',
    category: 'display',
    stack: `"Unbounded", ${SANS}`,
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  'roboto-slab': {
    label: 'Roboto Slab',
    category: 'slab',
    stack: `"Roboto Slab", ${SERIF}`,
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  'bodoni-moda': {
    label: 'Bodoni Moda',
    category: 'display',
    stack: `"Bodoni Moda", ${SERIF}`,
    weights: [400, 500, 600, 700, 800, 900],
  },
  quicksand: {
    label: 'Quicksand',
    category: 'rounded',
    stack: `"Quicksand", ${SANS}`,
    weights: [300, 400, 500, 600, 700],
  },
  'fira-code': {
    label: 'Fira Code',
    category: 'mono',
    stack: '"Fira Code", ui-monospace, monospace',
    weights: [300, ...STANDARD],
  },
  jetbrains: {
    label: 'JetBrains Mono',
    category: 'mono',
    stack: '"JetBrains Mono", ui-monospace, monospace',
    weights: [300, ...STANDARD],
  },
  'system-mono': {
    label: 'System monospace',
    category: 'system',
    stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    weights: [400, 500, 600, 700, 800],
  },
}

/** The CSS font-family stack for a bundled font. */
export function bundledFontStack(id: BundledFontId): string {
  return BUNDLED_FONTS[id].stack
}

/** The bundled font a stack belongs to, or null for a stack the registry does not have. */
export function bundledFontIdForStack(stack: string): BundledFontId | null {
  const entry = Object.entries(BUNDLED_FONTS).find(([, font]) => font.stack === stack)
  return entry ? (entry[0] as BundledFontId) : null
}

/** The CSS font-family stack for a design font; an uploaded family falls back to its bundled match. */
export function fontStack(font: DesignFont): string {
  if (font.kind === 'bundled') return bundledFontStack(font.id)
  return `"${font.family}", ${bundledFontStack(font.fallback)}`
}

/**
 * The narrowest word gap that still reads as one. A typical sans draws its
 * space at 0.23 to 0.26em; below about 0.22em, and more so set tight, words
 * run together ("Sendto the team").
 */
export const WORD_GAP_FLOOR = '0.22em'

/**
 * Each family's space at its narrowest weight, in em, measured from the
 * bundled files. The portal widens a word gap only where the face's own
 * space, less its tracking, falls below the floor.
 */
const SPACES: Partial<Record<BundledFontId, number>> = {
  inter: 0.237,
  roboto: 0.244,
  'open-sans': 0.26,
  lato: 0.193,
  nunito: 0.252,
  poppins: 0.212,
  'dm-sans': 0.235,
  jakarta: 0.165,
  geist: 0.229,
  manrope: 0.2,
  'space-grotesk': 0.254,
  'ibm-plex-sans': 0.236,
  'bricolage-grotesque': 0.23,
  playfair: 0.233,
  merriweather: 0.237,
  lora: 0.263,
  fraunces: 0.211,
  'inter-tight': 0.199,
  sora: 0.21,
  outfit: 0.19,
  figtree: 0.238,
  'work-sans': 0.286,
  'instrument-sans': 0.19,
  'noto-sans': 0.26,
  rubik: 0.213,
  'mona-sans': 0.213,
  'hanken-grotesk': 0.26,
  karla: 0.23,
  'libre-franklin': 0.206,
  'barlow-condensed': 0.2,
  oswald: 0.204,
  'source-serif': 0.218,
  archivo: 0.196,
  unbounded: 0.248,
  'roboto-slab': 0.244,
  'bodoni-moda': 0.25,
  quicksand: 0.27,
  'fira-code': 0.6,
  jetbrains: 0.6,
}

/** A typical face's space, for a system or uploaded family whose own is not known. */
const TYPICAL_SPACE = 0.25

/** A family's own word space, in em. */
export function wordGap(font: DesignFont): string {
  const space = font.kind === 'bundled' ? SPACES[font.id] : undefined
  return `${space ?? TYPICAL_SPACE}em`
}

/** The bundled families a design's pages load: body first, then headings. */
export function designFontIds(doc: PortalDesign): BundledFontId[] {
  const { body, heading, display } = doc.brand.fonts
  const id = (font: DesignFont) => (font.kind === 'bundled' ? font.id : font.fallback)
  return [...new Set([id(body), id(heading), ...(display ? [id(display)] : [])])]
}

/** The weights a font has: a bundled family's stylesheet, or an uploaded family's upright files, lightest first. */
export function fontWeights(font: DesignFont): readonly number[] {
  if (font.kind === 'bundled') return BUNDLED_FONTS[font.id].weights
  return font.files
    .filter((file) => file.style === 'normal')
    .map((file) => file.weight)
    .sort((a, b) => a - b)
}

/**
 * The weights an exact value of a part can take: those of the face that
 * draws it, so no weight is faked. Headlines are in their own face, section
 * headings and card titles in the heading face, and the rest in the body face.
 */
export function tunedWeights(doc: PortalDesign, part: string): readonly number[] {
  const { heading, body, display } = doc.brand.fonts
  if (part === 'headline') return fontWeights(display ?? heading)
  return fontWeights(part === 'heading' || part === 'card' ? heading : body)
}

type HeadingWeight = PortalDesign['brand']['fonts']['headingWeight']

/**
 * The heading weight to keep with a new heading font: the same one if it has
 * it, else the nearest it has (the lighter on a tie), so a light headline
 * stays light and a heavy one heavy; 600 for a font with none of the steps.
 */
/**
 * The heading weights a design offers, the same list as DESIGN_OPTIONS.headingWeight
 * (a test holds them equal), kept here so admin pages that only name fonts do not
 * load every design option.
 */
export const HEADING_WEIGHTS = [300, 400, 500, 600, 700, 800] as const

export function closestWeight(font: DesignFont, current: HeadingWeight): HeadingWeight {
  const offered = HEADING_WEIGHTS.filter((weight) =>
    fontWeights(font).includes(weight)
  )
  if (!offered.length) return 600
  return offered.reduce((best, w) => (Math.abs(w - current) < Math.abs(best - current) ? w : best))
}
