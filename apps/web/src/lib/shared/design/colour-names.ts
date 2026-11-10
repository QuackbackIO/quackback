/** Colours as a person names them, never as codes: "navy", "a lighter navy". */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'

/**
 * A colour as a person names it, from its hue, lightness and how colourful
 * it is: black, grey or white; a pale tint (pale indigo); a muted tint (slate, taupe, sage, mauve); or a
 * hue, with its own words for light, dark and dark-but-muted colours (a deep,
 * greyed purple is aubergine or plum, not purple or pink).
 */
export function colourName(hex: string): string {
  const parsed = /^#[0-9a-f]{6}$/i.test(hex)
    ? parseOklch(hexToOklch(hex))
    : /^#[0-9a-f]{3}$/i.test(hex)
      ? parseOklch(hexToOklch(`#${[...hex.slice(1)].map((d) => d + d).join('')}`))
      : parseOklch(hex)
  if (!parsed) return 'colour'
  const { l, c, h } = parsed
  // Near white, any tint shows: a pale indigo is never white, nor slate.
  if (l > 0.88 && c >= 0.012 && c < 0.06) return `pale ${paleHue(h)}`
  if (c < 0.03) return l < 0.3 ? 'black' : l > 0.9 ? 'white' : 'grey'
  const dark = l < 0.42
  const light = l > 0.75
  // Muted: a grey with a tint, named by the tint.
  if (c < 0.06 && !dark) {
    if (h >= 200 && h < 290) return 'slate'
    if (h >= 20 && h < 110) return 'taupe'
    if (h >= 110 && h < 200) return 'sage'
    return 'mauve'
  }
  const muted = c < 0.14
  if (h < 20 || h >= 345) return dark ? 'burgundy' : 'pink'
  if (h < 45) return l > 0.7 ? 'coral' : dark ? 'maroon' : 'red'
  if (h < 70) return dark ? 'brown' : 'orange'
  if (h < 105) return dark ? 'olive' : 'yellow'
  if (h < 140) return dark ? 'forest green' : l > 0.8 ? 'lime' : 'green'
  if (h < 175) return dark ? 'dark green' : 'green'
  if (h < 215) return dark ? 'dark teal' : 'teal'
  if (h < 265) return dark ? 'navy' : 'blue'
  if (h < 290) return light ? 'periwinkle' : 'indigo'
  // Purples: deep and greyed is aubergine (bluer) or plum (redder); pale is lavender.
  if (dark && muted) return h < 325 ? 'aubergine' : 'plum'
  if (light) return h < 325 ? 'lavender' : 'pink'
  if (l < 0.3) return 'deep purple'
  return h < 330 ? 'purple' : 'magenta'
}

/** A pale tint's hue in a word. */
function paleHue(h: number): string {
  if (h < 20 || h >= 345) return 'pink'
  if (h < 70) return 'peach'
  if (h < 110) return 'yellow'
  if (h < 175) return 'green'
  if (h < 215) return 'teal'
  if (h < 265) return 'blue'
  if (h < 290) return 'indigo'
  return h < 330 ? 'purple' : 'pink'
}

/**
 * The second colour's name, never the brand colour's again: a second colour
 * of the same name is said as a deeper or lighter shade of it.
 */
export function secondName(identity: string, second: string): string {
  const name = colourName(second)
  if (name !== colourName(identity)) return name
  const a = parseOklch(hexToOklch(identity))
  const b = parseOklch(hexToOklch(second))
  return `${a && b && b.l > a.l ? 'lighter' : 'deeper'} ${name}`
}

const CODE = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|oklch\([^)]*\)/gi

/**
 * Words for a person, never colour codes: a code after a colour's name goes
 * ("navy (#1f2a44)" is "navy"), and a code alone is said by its name.
 */
export function plainWords(text: string): string {
  return text
    .replace(new RegExp(`\\s*\\((?:${CODE.source})\\)`, 'gi'), '')
    .replace(CODE, (code) => colourName(code))
}

/**
 * Words that mark a reason as the builder's own, not a person's: ids, JSON,
 * keys, roles, and a list of the fields a setting takes ("it takes stops,
 * shape, direction, centre and strength").
 */
const INTERNAL =
  /[{}"`_]|\bJSON\b|\bids?\b|\bop\b|\bkey\b|\btokens?\b|\b(accent|support|ink|muted|surface)\b|\b\d+(px|em)\b|\btakes? \w+(?:, \w+)+,? (?:and|or) \w+/i

/** A reason a change was left alone, said to a person, or null where it is the builder's own. */
export function plainReason(reason: string): string | null {
  const words = plainWords(reason).trim()
  return words && !INTERNAL.test(words) ? words : null
}

/** Up to three reasons a person can read, joined; empty when none is. */
export function plainReasons(reasons: readonly string[]): string {
  const plain = reasons.map(plainReason).filter((reason): reason is string => !!reason)
  return [...new Set(plain)].slice(0, 3).map(lowerFirst).join('; ')
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`
