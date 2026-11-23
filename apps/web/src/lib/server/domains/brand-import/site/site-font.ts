/**
 * Whether the font a site's text is set in may be copied to the portal, from
 * the files themselves (font-file.ts) and where they are served:
 *
 * - a font service's files are never copied;
 * - nor is a file whose maker set the restricted-licence embedding bit;
 * - a file under the SIL Open Font License or Apache is copied freely;
 * - any other is a commercial font the site hosts itself: copied, and held
 *   until the person confirms the brand owns or licenses it.
 *
 * A family whose regular file lacks the Latin letters (a subset cut for one
 * headline) or is over the size cap is not copied, and says why.
 */
import {
  sameFontFamily,
  type BrandRead,
  type SiteFontBytes,
  type SiteFontRefusal,
} from '@/lib/shared/theme/brand-import'
import { familyAsFileNames } from '@/lib/shared/theme/font-names'
import { FONT_FAMILY_NAME } from '@/lib/shared/theme/font-uploads'
import { fontLicence, readFontFile } from './font-file'
import { isFontServiceUrl } from './font-services'

/** The most one copied font file may weigh. */
export const SITE_FONT_MAX_BYTES = 400 * 1024
/** A font with fewer glyphs than this, and no character map we read, is a subset. */
const MIN_GLYPHS = 90

export interface SiteFontInput {
  /** The family as the site's stylesheet names it. */
  family: string
  /** The reader saw a font service serving it. */
  service?: boolean
  /** The reader left a file out for its size. */
  tooLarge?: boolean
  /** The regular file first, then the bold. */
  files: { url: string; weight: number; weightTo?: number; bytes: Uint8Array }[]
}

/** The family as a name a stylesheet can hold, or null when nothing is left of it. */
function writableFamily(family: string): string | null {
  const name = [...family.trim()]
    .filter((char) => FONT_FAMILY_NAME.test(char))
    .join('')
    .trim()
    .slice(0, 64)
    .trim()
  return name.length > 0 ? name : null
}

/**
 * The family as the file's own name table names it, when the file plainly
 * names the same family (font-names.ts `familyAsFileNames`):
 * `Abcgintonorthwind` is ABC Ginto Northwind, `northwindregular` Northwind.
 * A file that names another family, or nothing, changes nothing.
 */
function spelledByFile(family: string, bytes: Uint8Array | undefined): string {
  const named =
    bytes && bytes.byteLength <= SITE_FONT_MAX_BYTES ? readFontFile(bytes)?.family : null
  const own = named ? writableFamily(named) : null
  return own ? (writableFamily(familyAsFileNames(family, own)) ?? family) : family
}

/** What Import may do with the site's font, or undefined when it read no usable file. */
export function classifySiteFont(input: SiteFontInput): BrandRead['siteFont'] {
  const written = writableFamily(input.family)
  if (!written) return undefined
  const spelled = spelledByFile(written, input.files[0]?.bytes)
  // What the stylesheet calls it, kept when the file names it another way.
  const name = sameFontFamily(spelled, written)
    ? { family: spelled }
    : { family: spelled, named: written }
  const result = classify(input, name.family)
  return result ? { ...name, ...result } : undefined
}

type Classified =
  { licence: 'open' | 'commercial'; files: SiteFontBytes[] } | { notCopied: SiteFontRefusal }

function classify(
  input: SiteFontInput,
  family: string
): (Classified & { family: string }) | undefined {
  if (input.service || input.files.some((file) => isFontServiceUrl(file.url)))
    return { family, notCopied: 'service' }

  const read = input.files.map((file, index) => {
    const facts = file.bytes.byteLength <= SITE_FONT_MAX_BYTES ? readFontFile(file.bytes) : null
    return { file, facts, regular: index === 0 }
  })
  if (read.some(({ facts }) => facts && fontLicence(facts) === 'restricted'))
    return { family, notCopied: 'restricted' }

  const regular = read[0]
  if (!regular) return input.tooLarge ? { family, notCopied: 'too-large' } : undefined
  if (regular.file.bytes.byteLength > SITE_FONT_MAX_BYTES) return { family, notCopied: 'too-large' }
  const isSubset = (facts: NonNullable<(typeof regular)['facts']>) =>
    facts.latin === false ||
    (facts.latin === null && facts.glyphs !== null && facts.glyphs < MIN_GLYPHS)
  if (!regular.facts) return undefined
  if (isSubset(regular.facts)) return { family, notCopied: 'subset' }

  const kept = read.filter(({ facts }) => facts && !isSubset(facts))
  const licence = kept.every(({ facts }) => fontLicence(facts!) === 'open') ? 'open' : 'commercial'
  // A variable font declared at one weight still holds them all: say so, when it stands alone.
  const axis = kept.length === 1 ? kept[0]!.facts!.weightRange : null
  const range =
    axis && kept[0]!.file.weightTo === undefined
      ? { weight: Math.max(100, axis[0]), weightTo: Math.min(900, axis[1]) }
      : null
  return {
    family,
    licence,
    files: kept.map(({ file, facts }) => ({
      bytes: file.bytes,
      format: facts!.format,
      weight: file.weight,
      ...(file.weightTo !== undefined ? { weightTo: file.weightTo } : {}),
      ...(range && range.weightTo > range.weight ? range : {}),
    })),
  }
}
