/**
 * A step Ask AI took, said in one short sentence: a brand match names the
 * parts of the portal it matched, never each setting.
 */

/** The parts a change can be in, in the order a summary names them; the rest are styles. */
const PARTS: Array<[part: string, matches: RegExp]> = [
  ['logo', /^brand\.(logo|favicon|shareImage)\b/],
  [
    'hero',
    /^(brand\.heroImage|layout\.(hero\w*|blend|fadeFrom|imagePlace|imageFocus|headerOnHero))\b/,
  ],
  [
    'colours',
    /^(mode|brand\.(light|dark|logoColours)|styleDark|layout\.(background|pageBackgrounds|tint))\b/,
  ],
  [
    'fonts',
    /^(brand\.fonts|tune\.\w+\.(size|weight|tracking|leading|case|titleSize|titleWeight))\b/,
  ],
  ['words', /^(pages\.\w+\.(copy|headline|welcome)|pages\.titles|nav\.home\.label)\b/],
  ['layout', /^(pages\.home\.blocks|nav\.items|layout\.(width|density|header|nav|menuAlign))\b/],
]

const ORDER = ['colours', 'fonts', 'logo', 'hero', 'words', 'layout', 'styles']

/** The parts of the portal the changes at these paths are in, each once, in summary order. */
export function partsChanged(paths: readonly string[]): string[] {
  const parts = new Set(
    paths.map((path) => PARTS.find(([, matches]) => matches.test(path))?.[0] ?? 'styles')
  )
  return ORDER.filter((part) => parts.has(part))
}

/** Words joined as a person lists them: "a, b and c". */
const listed = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

/** The parts a brand match names; the rest (hero, layout, styles) go without saying. */
const NAMED = ['colours', 'fonts', 'logo', 'words']

/** A brand match in one line: "Matched your brand: colours, fonts, logo and words." */
export function matchSummary(paths: readonly string[], options: { logo?: boolean } = {}): string {
  const parts = new Set(partsChanged(paths))
  if (options.logo) parts.add('logo')
  const sorted = NAMED.filter((part) => parts.has(part))
  return sorted.length ? `Matched your brand: ${listed(sorted)}.` : 'Matched your brand.'
}
