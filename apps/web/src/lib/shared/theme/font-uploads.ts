import type { BrandingFontId } from './fonts'

/** One uploaded font file of a family. */
export interface CustomFontFile {
  key: string
  weight: number
  /** The highest weight a variable font covers, when it is more than `weight`. */
  weightTo?: number
  style: 'normal' | 'italic'
}

/** A workspace's uploaded font family, stored in `branding_config.customFont`. */
export interface CustomFont {
  family: string
  files: CustomFontFile[]
  /** The bundled family shown until the files load, and for glyphs they lack. */
  fallback: BrandingFontId
}

/** The font files a workspace may upload: each format's type, and how large one may be. */
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

/**
 * Where an uploaded font file is kept: a woff2, woff, ttf or otf file under
 * `fonts/` in the workspace's storage. The key is written into the page's CSS,
 * so it holds only characters that cannot end a `url()`, and no segment starts
 * with a dot.
 */
export const UPLOADED_FONT_KEY =
  /^fonts\/(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.(?:woff2|woff|ttf|otf)$/

/** A family name is written into `font-family` and `@font-face`: letters, digits, space, dot, underscore, hyphen. */
export const FONT_FAMILY_NAME = /^[\p{L}\p{N} ._-]+$/u

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

/** Whether a stored family and its files are safe to write into a stylesheet. */
export function isWritableCustomFont(font: CustomFont | null | undefined): font is CustomFont {
  return (
    !!font &&
    typeof font.family === 'string' &&
    font.family.length > 0 &&
    font.family.length <= 64 &&
    font.family === font.family.trim() &&
    FONT_FAMILY_NAME.test(font.family) &&
    Array.isArray(font.files) &&
    font.files.length > 0 &&
    font.files.length <= FONT_UPLOADS.maxFiles &&
    font.files.every(
      (file) =>
        typeof file.key === 'string' &&
        file.key.length <= 512 &&
        UPLOADED_FONT_KEY.test(file.key) &&
        Number.isInteger(file.weight) &&
        file.weight >= 100 &&
        file.weight <= 900 &&
        (file.weightTo === undefined ||
          (Number.isInteger(file.weightTo) &&
            file.weightTo > file.weight &&
            file.weightTo <= 900)) &&
        (file.style === 'normal' || file.style === 'italic')
    )
  )
}

/**
 * The `@font-face` rules for an uploaded family, one per file. Empty when the
 * stored family or a key is not one the upload route could have issued, so a
 * bad row can never write into the stylesheet.
 */
export function uploadedFontFaces(font: CustomFont | null | undefined): string {
  if (!isWritableCustomFont(font)) return ''
  return font.files
    .map((file) => {
      const ext = fontExtension(file.key) ?? 'woff2'
      return `@font-face { font-family: "${font.family}"; src: url("${uploadedFontUrl(file.key)}") format("${FONT_FORMATS[ext].format}"); font-weight: ${file.weightTo ? `${file.weight} ${file.weightTo}` : file.weight}; font-style: ${file.style}; font-display: swap; }`
    })
    .join(' ')
}
