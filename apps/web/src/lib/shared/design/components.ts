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
