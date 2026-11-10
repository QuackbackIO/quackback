/**
 * The bundled face closest to a brand's own. A family that is bundled matches
 * itself; a well-known typeface maps to the bundled face of its class and
 * build: a grotesk to a grotesk, a strict geometric to a geometric, a
 * humanist to a humanist, and a company's own cut of an open family (its
 * Inter, its Noto) to that family. Anything else is left to the person or
 * Quackback AI to choose, and a brand can always upload its own licensed
 * files.
 */
import { BUNDLED_FONTS, type BundledFontId } from './fonts'

const NEAREST: ReadonlyArray<readonly [RegExp, BundledFontId]> = [
  // Rounded faces, before the families they round.
  [/rounded|vag ?round|arial round|quicksand/, 'quicksand'],
  // Wide and heavy display grotesks.
  [/extended|expanded|druk wide|neue machina|clash display|syne/, 'unbounded'],
  [/archivo|neue haas display|gt america (black|extended)|obviously/, 'archivo'],
  // Grotesks and neo-grotesks.
  [
    /s[oö]hne|gt america|founders grotesk|calibre|aeonik|suisse|haas|helvetica|akzidenz|graphik|basis grotesque/,
    'inter-tight',
  ],
  [/sf pro|san francisco|-apple-system|segoe|^inter display/, 'inter'],
  // A company's own cut of Inter, named for it ("Acme Inter", "AcmeInter").
  [/[a-z]{4,} ?inter$/, 'inter'],
  [/univers|frutiger|din\b|roboto flex/, 'roboto'],
  [/franklin gothic|news gothic|trade gothic/, 'libre-franklin'],
  // Strict geometrics.
  [/futura|avant[ -]?garde|larsseit|gilroy|brandon|gotham|montserrat|tt norms|campton/, 'outfit'],
  [/circular|cereal|gt walsheim|apercu|euclid/, 'figtree'],
  [/proxima nova|avenir|museo sans|sofia pro/, 'figtree'],
  [/cera/, 'dm-sans'],
  // A company's own cut of Noto ("Noto Acme"), and Verdana's build.
  [/^noto (?!sans|serif|mono|color|emoji)[a-z]+$|verdana/, 'noto-sans'],
  // Condensed and display.
  [/knockout|tungsten|druk|bebas|league gothic|din condensed/, 'barlow-condensed'],
  [/impact|alternate gothic/, 'oswald'],
  // Serifs.
  [/tiempos|publico|freight text|chronicle|georgia/, 'source-serif'],
  [/canela|gt super|recoleta|cooper/, 'fraunces'],
  [/bodoni/, 'bodoni-moda'],
  [/didot|editorial new/, 'playfair'],
  // Slab serifs.
  [/slab|rockwell|clarendon|archer|sentinel|egyptienne|courier/, 'roboto-slab'],
  // Monospace.
  [/sf mono|menlo|monaco|consolas|berkeley mono|jetbrains/, 'jetbrains'],
]

const GENERIC =
  /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-[\w-]+|segoe ui|roboto|helvetica( neue)?|arial|apple color emoji|segoe ui emoji|noto color emoji)$/i

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
  const stack = family.split(',')
  for (const [index, one] of stack.entries()) {
    // A generic family past the first is a fallback, not the brand's face.
    if (index > 0 && GENERIC.test(one.trim().replace(/["']/g, ''))) continue
    const found = nearestOne(one)
    if (found) return found
  }
  return null
}
