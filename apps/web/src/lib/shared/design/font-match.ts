/**
 * The bundled face closest to a brand's own. A family that is bundled matches
 * itself; a well-known brand face maps to the bundled face of its class and
 * build: a grotesk to a grotesk, a strict geometric to a geometric, a
 * humanist to a humanist. Anything else is left to the person or Quackback
 * AI to choose, and a brand can always upload its own licensed files.
 */
import { BUNDLED_FONTS, type BundledFontId } from './fonts'

const NEAREST: ReadonlyArray<readonly [RegExp, BundledFontId]> = [
  // Grotesks and neo-grotesks.
  [
    /s[oö]hne|gt america|founders grotesk|calibre|aeonik|suisse|haas|helvetica|akzidenz|graphik|basis grotesque|wise sans/,
    'inter-tight',
  ],
  [
    /sf pro|san francisco|-apple-system|segoe|salesforce sans|notion ?inter|^inter display/,
    'inter',
  ],
  [/univers|frutiger|din\b|roboto flex/, 'roboto'],
  [/franklin gothic|news gothic|trade gothic/, 'libre-franklin'],
  // Strict geometrics.
  [
    /futura|avant ?garde|salesforce.?avant|larsseit|gilroy|brandon|gotham|montserrat|tt norms|campton/,
    'outfit',
  ],
  [/circular|cereal|gt walsheim|apercu|euclid/, 'figtree'],
  [/proxima nova|avenir|museo sans|sofia pro/, 'figtree'],
  [/monzo ?sans|stripe ?sans|cera/, 'dm-sans'],
  [/noto ikea|ikea sans|verdana/, 'noto-sans'],
  // Condensed and display.
  [/knockout|tungsten|druk|bebas|league gothic|din condensed/, 'barlow-condensed'],
  [/impact|alternate gothic/, 'oswald'],
  // Serifs.
  [/tiempos|publico|freight text|chronicle|georgia/, 'source-serif'],
  [/canela|gt super|recoleta|cooper/, 'fraunces'],
  [/didot|bodoni|editorial new/, 'playfair'],
  // Monospace.
  [/sf mono|menlo|monaco|consolas|berkeley mono|jetbrains/, 'jetbrains'],
]

const simplify = (name: string) =>
  name
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\b(variable|var|vf|web)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** One family's bundled face, or the one closest to it, or null. */
function nearestOne(family: string): BundledFontId | null {
  const name = simplify(family)
  const bare = name.replace(/[^a-z0-9]/g, '')
  if (!bare) return null
  for (const [id, font] of Object.entries(BUNDLED_FONTS) as Array<
    [BundledFontId, { label: string }]
  >) {
    if (font.label.toLowerCase().replace(/[^a-z0-9]/g, '') === bare) return id
  }
  return NEAREST.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

/**
 * The bundled face a family is, or the one closest to it, or null. Given a
 * stack, the first family it knows wins, as a browser reads one.
 */
export function nearestBundledFont(family: string | null | undefined): BundledFontId | null {
  if (!family) return null
  for (const one of family.split(',')) {
    const found = nearestOne(one)
    if (found) return found
  }
  return null
}
