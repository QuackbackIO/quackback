/**
 * The card style as CSS: how the portal's cards (post cards, the welcome
 * card, the composer, the side panels) stand off the page. Border is the
 * stylesheet's own look and writes nothing. Shadow and Flat are written as
 * the variables each card reads (`.portal-card` in globals.css), worked out
 * for each side from that side's own colours:
 *
 * - Shadow: a soft shadow and no border on a light page; on a dark page,
 *   where a shadow vanishes, the faint border stays.
 * - Flat: no border or shadow, and a fill that stands off the page at 1.1:1
 *   or more with the quiet text still readable on it. What sits on a filled
 *   card as a quiet fill (the chosen row of a panel, a vote button) takes
 *   the card colour, so it still shows. When no such fill exists, the faint
 *   border stays instead.
 *
 * `initial` empties a variable, which hands that side back to the card's own
 * default, so one side's look never shows on the other.
 */
import { tryCssColorToHex } from './colors'
import { contrastOf, expandTheme, relativeLuminance, type MinimalThemeVariables } from './expand'
import type { CardStyle, ThemeMode } from './types'

type Palette = Partial<MinimalThemeVariables>
type Side = 'light' | 'dark'

/** A flat card's fill stands off the page by this much, or the border stays. */
export const FLAT_STANDS_OFF = 1.1
const READABLE = 4.5
/** How much of the text colour is mixed into the page for a flat fill, lightest first. */
const FLAT_MIXES = [0.06, 0.08, 0.1] as const

const SHADOW = {
  light: '0 1px 2px oklch(0 0 0 / 0.05), 0 6px 20px -10px oklch(0 0 0 / 0.22)',
  dark: '0 1px 2px oklch(0 0 0 / 0.3), 0 8px 24px -10px oklch(0 0 0 / 0.6)',
} as const

/** The card's own default, as the stylesheet has it. */
const OWN = 'initial'

/**
 * A page dark enough that a shadow vanishes on it: the line the editor's
 * colour setters draw too. Worked out here from the theme's own contrast
 * helpers, because every page generates this CSS and only the Customise
 * editor loads the setters.
 */
const isDarkBackground = (hex: string) => relativeLuminance(hex) < 0.2

/**
 * A colour drawn as text (a tag, a vote count) is held to a lightness that
 * reads on the page (`text-readable`). A flat card's fill is a step nearer
 * the text than the page is, so on it that limit moves a step too: darker on
 * a light fill, lighter on a dark one.
 */
const FLAT_INK = { lightMax: '0.44', darkMin: '0.88' } as const

function mix(from: string, toward: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(from, i) + (channel(toward, i) - channel(from, i)) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

const sixDigit = (colour: string | undefined): string | null => {
  const hex = colour ? tryCssColorToHex(colour) : null
  return hex && /^#[\da-f]{6}$/i.test(hex) ? hex : null
}

/**
 * The fill a flat card takes on this side: the page with a little of its
 * text colour mixed in, the lightest mix that stands off the page with the
 * quiet text still readable on it. Null when there is none, or a colour
 * cannot be read: the card then keeps its border.
 */
export function flatFill(palette: Palette, side: Side): string | null {
  const vars = expandTheme(palette, { mode: side })
  const page = sixDigit(vars.background)
  const text = sixDigit(vars.foreground)
  const quiet = sixDigit(vars.mutedForeground)
  // A colour that cannot be read is never guessed at.
  if (!page || !text || !quiet) return null
  for (const amount of FLAT_MIXES) {
    const fill = mix(page, text, amount)
    if (contrastOf(fill, page) < FLAT_STANDS_OFF) continue
    return contrastOf(quiet, fill) >= READABLE ? fill : null
  }
  return null
}

/** One side's card variables, or none for Border outside a draft. */
function sideVars(
  style: CardStyle,
  palette: Palette,
  side: Side,
  explicit: boolean
): Record<string, string> | null {
  if (style === 'shadow') {
    const page = sixDigit(expandTheme(palette, { mode: side }).background)
    const dark = page ? isDarkBackground(page) : side === 'dark'
    return {
      '--portal-card-border': dark ? OWN : 'transparent',
      '--portal-card-shadow': dark ? SHADOW.dark : SHADOW.light,
      '--portal-card-background': OWN,
      '--portal-card-inset': OWN,
      '--portal-card-ink-min': OWN,
      '--portal-card-ink-max': OWN,
    }
  }
  if (style === 'flat') {
    const fill = flatFill(palette, side)
    const dark = fill ? isDarkBackground(fill) : false
    return {
      '--portal-card-border': fill ? 'transparent' : OWN,
      '--portal-card-shadow': 'none',
      '--portal-card-background': fill ?? OWN,
      '--portal-card-inset': fill ? 'var(--card)' : OWN,
      '--portal-card-ink-min': fill && dark ? FLAT_INK.darkMin : OWN,
      '--portal-card-ink-max': fill && !dark ? FLAT_INK.lightMax : OWN,
    }
  }
  return explicit
    ? {
        '--portal-card-border': OWN,
        '--portal-card-shadow': OWN,
        '--portal-card-background': OWN,
        '--portal-card-inset': OWN,
        '--portal-card-ink-min': OWN,
        '--portal-card-ink-max': OWN,
      }
    : null
}

const blockOf = (selector: string, vars: Record<string, string>) =>
  `${selector} { ${Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')} }`

/**
 * The card style as CSS, on the selectors the theme itself uses: `:root` and
 * `.dark` when visitors choose, `:root` alone for a portal that is light or
 * dark only. `explicit` (a draft in the preview) writes both sides whatever
 * the mode, and writes Border too, over a saved Shadow or Flat.
 */
export function cardStyleCss(
  style: CardStyle | undefined,
  palettes: { light?: Palette | null; dark?: Palette | null },
  options: { themeMode?: ThemeMode; explicit?: boolean } = {}
): string {
  const explicit = options.explicit === true
  if (!style || (style === 'border' && !explicit)) return ''
  const mode = explicit ? 'user' : (options.themeMode ?? 'user')
  const light = sideVars(style, palettes.light ?? {}, 'light', explicit)
  const dark = sideVars(style, palettes.dark ?? {}, 'dark', explicit)
  if (!light || !dark) return ''
  if (mode === 'light') return blockOf(':root', light)
  if (mode === 'dark') return blockOf(':root', dark)
  return `${blockOf(':root', light)} ${blockOf('.dark', dark)}`
}
