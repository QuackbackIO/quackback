/**
 * A font upload read before anything is sent: each file's weight and style
 * guessed from its name, the family from the first file, and what is wrong
 * with the set. Plain functions; the dialog holds the state.
 */
import {
  FONT_FAMILY_NAME,
  FONT_FORMATS,
  FONT_UPLOADS,
  fontExtension,
  sizeLabel,
} from '@/lib/shared/theme/font-uploads'

export type FontStyle = 'normal' | 'italic'

/** One picked file with the weight and style it will be uploaded as. */
export interface PendingFontFile<F extends { name: string; size: number } = File> {
  file: F
  weight: number
  style: FontStyle
}

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/** A weight and style read from a file name such as `Brand-SemiBoldItalic.woff2`. */
export function guessFace(name: string): { weight: number; style: FontStyle } {
  const lower = name.toLowerCase()
  const style = /italic|oblique/.test(lower) ? 'italic' : 'normal'
  const number = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(lower)
  if (number) return { weight: Number(number[1]), style }
  const named: Array<[RegExp, number]> = [
    [/extra-?light|ultra-?light/, 200],
    [/semi-?bold|demi-?bold/, 600],
    [/extra-?bold|ultra-?bold/, 800],
    [/thin|hairline/, 100],
    [/light/, 300],
    [/medium/, 500],
    [/black|heavy/, 900],
    [/bold/, 700],
  ]
  return { weight: named.find(([pattern]) => pattern.test(lower))?.[1] ?? 400, style }
}

/** A family name read from a file name: the part before its weight or style. */
export function guessFamily(name: string): string {
  const base = name.replace(/\.(?:woff2|woff|ttf|otf)$/i, '').split(/[-_]/)[0] ?? ''
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').trim()
}

const STYLE_NAMES: Record<FontStyle, string> = { normal: 'upright', italic: 'italic' }

const maxBytesOf = (name: string) => FONT_FORMATS[fontExtension(name) ?? 'woff2'].maxBytes

/** What is wrong with the files and name before anything uploads, or null. */
export function fontUploadProblem(
  family: string,
  files: ReadonlyArray<PendingFontFile<{ name: string; size: number }>>
): string | null {
  if (files.length > FONT_UPLOADS.maxFiles) return 'Up to six files per font.'
  const wrong = files.find(({ file }) => !fontExtension(file.name))
  if (wrong) return `${wrong.file.name} isn't a WOFF2, WOFF, TTF or OTF file.`
  const large = files.find(({ file }) => file.size > maxBytesOf(file.name))
  if (large) return `${large.file.name} is over ${sizeLabel(maxBytesOf(large.file.name))}.`
  const seen = new Set<string>()
  for (const { weight, style } of files) {
    const face = `${weight} ${STYLE_NAMES[style]}`
    if (seen.has(face))
      return `Two files are set to ${face}. Give each file its own weight or style.`
    seen.add(face)
  }
  const name = family.trim()
  if (name && (name.length > 64 || !FONT_FAMILY_NAME.test(name)))
    return 'Use letters, numbers, spaces, dots, dashes and underscores in the name.'
  return null
}
