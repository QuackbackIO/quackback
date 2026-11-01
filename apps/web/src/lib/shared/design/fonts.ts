import { DEFAULT_FONT_SANS } from '@/lib/shared/theme/expand'
import type { PortalDesign } from './schema'
import type { BUNDLED_FONT_IDS } from './options'

export type BundledFontId = (typeof BUNDLED_FONT_IDS)[number]
type DesignFont = PortalDesign['brand']['fonts']['body']
type UploadedFont = Extract<DesignFont, { kind: 'uploaded' }>

/** Uploaded fonts: woff2 files of up to 400 KB, six to a family, kept under `fonts/`. */
export const FONT_UPLOADS = {
  type: 'font/woff2',
  maxBytes: 400 * 1024,
  maxFiles: 6,
  prefix: 'fonts',
} as const

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
  for (const font of [doc.brand.fonts.body, doc.brand.fonts.heading]) {
    if (font.kind !== 'uploaded') continue
    for (const file of font.files) {
      rules.add(
        `@font-face { font-family: "${font.family}"; src: url("${uploadedFontUrl(file.key)}") format("woff2"); font-weight: ${file.weight}; font-style: ${file.style}; font-display: swap; }`
      )
    }
  }
  return [...rules].join(' ')
}

export interface BundledFont {
  label: string
  category: 'sans' | 'serif' | 'mono' | 'system'
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
    weights: [400, 500, 600, 700, 800],
  },
  system: {
    label: 'System UI',
    category: 'system',
    stack: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    weights: [400, 500, 600, 700, 800],
  },
  roboto: { label: 'Roboto', category: 'sans', stack: `"Roboto", ${SANS}`, weights: STANDARD },
  'open-sans': {
    label: 'Open Sans',
    category: 'sans',
    stack: `"Open Sans", ${SANS}`,
    weights: STANDARD,
  },
  lato: { label: 'Lato', category: 'sans', stack: `"Lato", ${SANS}`, weights: [400, 700] },
  nunito: { label: 'Nunito', category: 'sans', stack: `"Nunito", ${SANS}`, weights: STANDARD },
  poppins: { label: 'Poppins', category: 'sans', stack: `"Poppins", ${SANS}`, weights: STANDARD },
  'dm-sans': { label: 'DM Sans', category: 'sans', stack: `"DM Sans", ${SANS}`, weights: STANDARD },
  jakarta: {
    label: 'Plus Jakarta Sans',
    category: 'sans',
    stack: `"Plus Jakarta Sans", ${SANS}`,
    weights: STANDARD,
  },
  // The package publishes Geist as the "Geist Sans" family.
  geist: { label: 'Geist', category: 'sans', stack: `"Geist Sans", ${SANS}`, weights: STANDARD },
  manrope: { label: 'Manrope', category: 'sans', stack: `"Manrope", ${SANS}`, weights: STANDARD },
  'space-grotesk': {
    label: 'Space Grotesk',
    category: 'sans',
    stack: `"Space Grotesk", ${SANS}`,
    weights: STANDARD,
  },
  'ibm-plex-sans': {
    label: 'IBM Plex Sans',
    category: 'sans',
    stack: `"IBM Plex Sans", ${SANS}`,
    weights: STANDARD,
  },
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    category: 'sans',
    stack: `"Bricolage Grotesque", ${SANS}`,
    weights: [400, 500, 600, 700, 800],
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
    weights: STANDARD,
  },
  lora: { label: 'Lora', category: 'serif', stack: `"Lora", ${SERIF}`, weights: STANDARD },
  fraunces: {
    label: 'Fraunces',
    category: 'serif',
    stack: `"Fraunces", ${SERIF}`,
    weights: [400, 500, 600, 700, 800],
  },
  'fira-code': {
    label: 'Fira Code',
    category: 'mono',
    stack: '"Fira Code", ui-monospace, monospace',
    weights: STANDARD,
  },
  jetbrains: {
    label: 'JetBrains Mono',
    category: 'mono',
    stack: '"JetBrains Mono", ui-monospace, monospace',
    weights: STANDARD,
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

/** The bundled families a design's pages load: body first, then headings. */
export function designFontIds(doc: PortalDesign): BundledFontId[] {
  const { body, heading } = doc.brand.fonts
  const id = (font: DesignFont) => (font.kind === 'bundled' ? font.id : font.fallback)
  return [...new Set([id(body), id(heading)])]
}
