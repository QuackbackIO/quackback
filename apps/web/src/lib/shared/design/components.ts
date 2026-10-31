/**
 * Component tokens and structural attributes for the portal.
 *
 * Tokens carry values: colours derived from the solved palette, and sizes
 * from the shape and layout choices. Attributes carry structure, such as the
 * header layout, which components read with `data-*` variants. The default
 * design reproduces the values the portal hard-codes today, so a converted
 * workspace keeps its look.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { mixColor } from './color'
import { solveContrast } from './contrast'
import { fontStack } from './fonts'
import type { PortalDesign } from './schema'

type Mode = 'light' | 'dark'
export type TokenMap = Record<`--qb-${string}`, string>

/**
 * The portal's own variables, which its components already read, by the token
 * each one now follows. Written only for the design engine; legacy keeps the
 * stylesheet's values.
 */
export const PORTAL_ALIASES: Record<string, `--qb-${string}`> = {
  '--header-background': '--qb-header-bg',
  '--header-foreground': '--qb-header-ink',
  '--header-border': '--qb-header-rule',
  '--nav-active-background': '--qb-nav-active-bg',
  '--nav-active-foreground': '--qb-nav-active-ink',
  '--nav-inactive-color': '--qb-nav-ink',
  '--post-card-voted-color': '--qb-vote-active',
  '--radius-item': '--qb-radius-control',
  '--radius-field': '--qb-radius-field',
  '--radius-panel': '--qb-radius-panel',
}

/** Buttons and badges, fields, and panels such as cards, dialogs and menus. */
const RADII: Record<PortalDesign['shape']['corners'], [string, string, string]> = {
  sharp: ['0rem', '0rem', '0rem'],
  subtle: ['0.25rem', '0.25rem', '0.375rem'],
  rounded: ['999px', '0.5rem', '0.75rem'],
  pill: ['999px', '0.75rem', '1.25rem'],
}

/** Card padding, the gap between cards and the post title size. */
const DENSITY: Record<PortalDesign['layout']['density'], [string, string, string]> = {
  compact: ['0.75rem', '0.5rem', '0.9375rem'],
  comfortable: ['1rem', '0.75rem', '1rem'],
  spacious: ['1.25rem', '1rem', '1.0625rem'],
}

type Fonts = PortalDesign['brand']['fonts']

/**
 * Headline size and line height by scale. Each shrinks with the viewport, so a
 * display headline still fits a phone.
 */
const HEADLINE: Record<NonNullable<Fonts['scale']>, [string, string]> = {
  standard: ['clamp(1.5rem, 1.25rem + 1vw, 1.875rem)', '1.2'],
  large: ['clamp(2rem, 1.5rem + 2.2vw, 3rem)', '1.1'],
  display: ['clamp(2.25rem, 1.2rem + 4.6vw, 4.75rem)', '1.02'],
}

const CASE = { sentence: 'none', upper: 'uppercase' } as const

/** Headline and label type: absent choices are today's. */
function typeTokens(fonts: Fonts): TokenMap {
  const [size, leading] = HEADLINE[fonts.scale ?? 'standard']
  const labels = fonts.labelCase ?? 'sentence'
  return {
    '--qb-headline-size': size,
    '--qb-headline-leading': leading,
    '--qb-heading-tracking': fonts.tracking === 'tight' ? '-0.035em' : '-0.02em',
    '--qb-headline-case': CASE[fonts.headlineCase ?? 'sentence'],
    '--qb-label-case': CASE[labels],
    // Upper-case labels read better spaced out.
    '--qb-label-tracking': labels === 'upper' ? '0.06em' : 'normal',
  }
}

const PAGE_MAX: Record<PortalDesign['layout']['width'], string> = {
  narrow: '56rem',
  default: '72rem',
  wide: '80rem',
}

/** The hairline under the header and around cards: softer than a field edge in light. */
function softBorder(vars: Required<ThemeVariables>, mode: Mode): string {
  return mode === 'light' ? mixColor(vars.border, vars.background, 0.6) : vars.border
}

/** Colour tokens for one mode, from its solved theme variables. */
export function modeTokens(doc: PortalDesign, vars: ThemeVariables, mode: Mode): TokenMap {
  const t = vars as Required<ThemeVariables>
  const tokens: TokenMap = {
    '--qb-header-bg': t.background,
    '--qb-header-ink': t.foreground,
    '--qb-header-rule': softBorder(t, mode),
    '--qb-nav-ink': t.mutedForeground,
    '--qb-nav-active-bg': t.muted,
    '--qb-nav-active-ink': t.foreground,
    // The voted vote box: the solver keeps accent text readable on cards.
    '--qb-vote-active': t.accentInk,
    ...bandTokens(doc.layout.band, t),
  }
  // The underline under the current page comes from the data-qb-nav attribute.
  if (doc.layout.nav === 'underline') tokens['--qb-nav-active-bg'] = 'transparent'
  if (doc.layout.nav === 'pills') {
    // The solver keeps accent text readable on the subtle accent.
    tokens['--qb-nav-active-bg'] = t.accent
    tokens['--qb-nav-active-ink'] = t.accentInk
  }
  return tokens
}

/** Text readable on a background, moved in lightness only if it has to be. */
const readableOn = (ink: string, background: string) => solveContrast(ink, [background], 4.5) ?? ink

/** The brand colour's share of a tint band, and of the top of a fade. */
export const BAND_TINT = 0.12
export const BAND_FADE = 0.2

/**
 * The band at the top of a page: plain, a tint of the brand colour, a fade
 * from a tint into the page, or the brand colour itself. Its text stays at
 * 4.5:1.
 */
function bandTokens(band: PortalDesign['layout']['band'], t: Required<ThemeVariables>): TokenMap {
  const tokens = bandSurface(band, t)
  // Where the headline sits: the band's colour, or the top of a fade.
  const behind =
    band === 'brand'
      ? t.primary
      : band === 'tint'
        ? mixColor(t.primary, t.background, BAND_TINT)
        : band === 'fade'
          ? mixColor(t.primary, t.background, BAND_FADE)
          : t.background
  return {
    ...tokens,
    // A headline's accent phrase: the brand colour, moved until it reads at
    // 3:1 as large text, or the band's ink where it cannot.
    '--qb-band-accent': solveContrast(t.primary, [behind], 3) ?? tokens['--qb-band-ink']!,
    '--qb-band-highlight': mixColor(t.primary, behind, 0.25),
  }
}

function bandSurface(band: PortalDesign['layout']['band'], t: Required<ThemeVariables>): TokenMap {
  switch (band) {
    case 'brand':
      return {
        '--qb-band-bg': t.primary,
        '--qb-band-ink': t.primaryForeground,
        '--qb-band-muted': t.primaryForeground,
      }
    case 'tint': {
      const tint = mixColor(t.primary, t.background, BAND_TINT)
      return {
        '--qb-band-bg': tint,
        '--qb-band-ink': readableOn(t.foreground, tint),
        '--qb-band-muted': readableOn(t.mutedForeground, tint),
      }
    }
    case 'fade': {
      const top = mixColor(t.primary, t.background, BAND_FADE)
      return {
        '--qb-band-bg': `linear-gradient(to bottom, ${top}, ${t.background})`,
        '--qb-band-ink': readableOn(t.foreground, top),
        '--qb-band-muted': readableOn(t.mutedForeground, top),
      }
    }
    default:
      return {
        '--qb-band-bg': 'transparent',
        '--qb-band-ink': t.foreground,
        '--qb-band-muted': t.mutedForeground,
      }
  }
}

/** Size tokens, the same in both modes. */
export function baseTokens(doc: PortalDesign): TokenMap {
  const [control, field, panel] = RADII[doc.shape.corners]
  const [padding, gap, title] = DENSITY[doc.layout.density]
  return {
    '--qb-radius-control': control,
    '--qb-radius-field': field,
    '--qb-radius-panel': panel,
    '--qb-nav-radius': doc.layout.nav === 'pills' ? '999px' : 'calc(var(--radius) * 0.8)',
    '--qb-card-padding': padding,
    // List cards run together, divided by their rules.
    '--qb-feed-gap': doc.layout.cards === 'list' ? '0rem' : gap,
    '--qb-title-size': title,
    '--qb-page-max': PAGE_MAX[doc.layout.width],
    '--qb-font-body': fontStack(doc.brand.fonts.body),
    '--qb-font-heading': fontStack(doc.brand.fonts.heading),
    '--qb-heading-weight': String(doc.brand.fonts.headingWeight),
    ...typeTokens(doc.brand.fonts),
  }
}

/** The structural choices, as attributes on `<html>`. */
export function layoutAttributes(doc: PortalDesign): Record<`data-qb-${string}`, string> {
  const { header, nav, band, cards, filters } = doc.layout
  return {
    'data-qb-header': header,
    'data-qb-nav': nav,
    'data-qb-band': band,
    'data-qb-cards': cards,
    'data-qb-filters': filters,
  }
}
