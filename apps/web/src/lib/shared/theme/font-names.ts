/**
 * Font family names as people read them, and whether two names are one
 * family in two cuts. Plain string work with no imports, so the browser
 * reader's sidecar can use it too.
 */

/** A family without a variable-font or web suffix (`Inter Variable` is Inter). */
const withoutSuffix = (name: string) =>
  name.replace(/[\s_-]+(variable|var|vf|web)$/i, '').trim() || name

/** A word that says which weight or slant one file is, not which family it belongs to. */
const WEIGHT_WORD =
  /^(?:thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|italic|oblique|[1-9]00)$/i
/** A build's hash after a name (`Inter 5486e50ce5a4efdf`): six or more hex digits, one at least a numeral. */
const BUILD_HASH = /^(?=[\da-f]*\d)[\da-f]{6,}$/i
/** A web font kit's code (`Frutiger W01`), alone or run into the word before it (`LTW02`). */
const KIT_CODE = /^(.*?)W\d{2}$/

/**
 * The family's words without what a stylesheet adds after them when it names
 * one file as if it were a family: a weight, a build hash or a kit code. The
 * first word always stays, so a family named `Regular` is still that.
 */
function withoutFileWords(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  while (words.length > 1) {
    const last = words.at(-1)!
    const kit = KIT_CODE.exec(last)
    if (WEIGHT_WORD.test(last) || BUILD_HASH.test(last) || kit?.[1] === '') words.pop()
    else if (kit && /^[A-Z]{2,}$/.test(kit[1]!)) words[words.length - 1] = kit[1]!
    else break
  }
  return words.join(' ')
}

/**
 * A family as a person would read it: `MonzoSansText` is Monzo Sans Text,
 * `adobe-clean` Adobe Clean, `sohne-var` Sohne, `Source Sans Pro Regular`
 * Source Sans Pro. A name that already has spaces is taken as written; one
 * without has its CamelCase, hyphens and underscores split into words. A
 * weight, a build hash or a kit code after the name is left off.
 */
export function fontDisplayName(name: string): string {
  let bare = withoutSuffix(name.trim())
  if (!/\s/.test(bare))
    bare = bare
      .replace(/[-_]+/g, ' ')
      .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  bare = withoutFileWords(bare)
  // A camelCase name starts as a name does (`figmaSans` is Figma Sans).
  if (bare !== bare.toLowerCase() && !/\s/.test(name.trim()))
    return bare.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
  if (bare === '' || bare !== bare.toLowerCase()) return bare || name
  return bare.replace(
    /(^|[\s-])(\p{Ll})/gu,
    (_, gap: string, letter: string) => gap + letter.toUpperCase()
  )
}

/** Words that name a cut of a family, not the family: its optical size, class or weight. */
const CUT_WORDS = new Set([
  'display',
  'text',
  'title',
  'headline',
  'heading',
  'head',
  'sans',
  'serif',
  'thin',
  'hairline',
  'extralight',
  'ultralight',
  'light',
  'regular',
  'normal',
  'book',
  'medium',
  'semibold',
  'demibold',
  'demi',
  'semi',
  'extra',
  'ultra',
  'bold',
  'extrabold',
  'ultrabold',
  'black',
  'heavy',
])

/** The family's own words: its name without the words for a cut. */
function familyWords(name: string): string {
  return fontDisplayName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !CUT_WORDS.has(word))
    .join(' ')
}

/**
 * Whether two names are one family in two cuts: Monzo Sans Display and Monzo
 * Sans Text, Charlie Display and Charlie Text, Klarna Title and Klarna Text.
 * A name that is only cut words (`Display`) is no family, and matches nothing.
 */
export function oneFontFamily(a: string, b: string): boolean {
  const [x, y] = [familyWords(a), familyWords(b)]
  return x !== '' && x === y
}

/** A family's letters and numerals, as a person reads the name (`sohne-var` is `sohne`). */
const lettersOf = (name: string) =>
  fontDisplayName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** What a foundry writes in a web font's name table in place of a name. */
const NOT_A_NAME = /web ?font|licen[cs]|copyright|\btrial\b|\bdemo\b|https?:|©|\buse only\b/i
/** One or more weight words run together (`regular`, `semibold`, `bolditalic`). */
const WEIGHT_RUN =
  /^(?:thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)+$/

const isSubsequence = (short: string, long: string) => {
  let at = 0
  for (const char of long) if (char === short[at]) at++
  return at === short.length
}

/**
 * A family as its own font file names it, when the file plainly names the
 * same family and spells it better than the stylesheet does:
 *
 * - the same letters, spaced and capitalised (`Abcgintonorthwind` is ABC Ginto Northwind);
 * - the stylesheet ran a weight into the name (`northwindregular` is Northwind);
 * - the stylesheet ran the words together and dropped one (`NorthSansforNW`
 *   is North Sans Nova for NW).
 *
 * Otherwise the stylesheet's name stands: the file may name another family,
 * a foundry's notice, or nothing.
 */
export function familyAsFileNames(family: string, fileFamily: string | null | undefined): string {
  const named = fileFamily?.replace(/\s+/g, ' ').trim()
  if (!named || named.length > 48 || NOT_A_NAME.test(named)) return family
  const file = fontDisplayName(named)
  const [css, own] = [lettersOf(family), lettersOf(file)]
  if (own.length < 3 || css.length < 3) return family
  if (css === own) return file
  // A weight run into the stylesheet's name.
  if (css.startsWith(own) && WEIGHT_RUN.test(css.slice(own.length))) return file
  // Words run together in the stylesheet, set apart in a file that is itself written in words.
  const runTogether = !/\s/.test(family.trim()) && /\s/.test(fontDisplayName(family))
  const inWords = /\s/.test(file) && !/\p{Ll}\p{Lu}|\p{L}\d/u.test(file)
  if (
    runTogether &&
    inWords &&
    own.length <= css.length * 1.5 &&
    own.slice(0, 4) === css.slice(0, 4) &&
    isSubsequence(css, own)
  )
    return file
  return family
}

/** A face a stack lists for emoji, flags, icons or currency signs, never for its text. */
export function isSymbolFace(name: string): boolean {
  return /emoji|font ?awesome|icomoon|\b(?:rial|riyal|dirham|dinar|rupee|lira|currency|flags?|symbols?|icons?|glyphicons|dingbats?)\b/i.test(
    name
  )
}
