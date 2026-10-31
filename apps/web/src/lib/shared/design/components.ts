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
import { bandArtImage, EDGE_ART, type BandArt } from './band-art'
import { mixColor, tintOf } from './color'
import { contrastRatio, solveContrast } from './contrast'
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
  // Buttons, badges and tabs: a button shape, when the design gives one, else the corners.
  '--radius-item': '--qb-radius-button',
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

/** Buttons, and the composer that carries one, by button shape. */
const BUTTON_RADII: Record<
  Exclude<NonNullable<PortalDesign['shape']['buttons']>, 'match'>,
  [string, string]
> = {
  square: ['0rem', '0rem'],
  rounded: ['0.5rem', '0.75rem'],
  pill: ['999px', '1.75rem'],
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

/** The other pages' titles: a step below Home's headline, on the same scale. */
const PAGE_TITLE: Record<NonNullable<Fonts['scale']>, string> = {
  standard: 'clamp(1.5rem, 1.3rem + 0.8vw, 1.875rem)',
  large: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.375rem)',
  display: 'clamp(2rem, 1.4rem + 2.4vw, 3.25rem)',
}

const CASE = { sentence: 'none', upper: 'uppercase' } as const

/** Headline and label type: absent choices are today's. */
function typeTokens(fonts: Fonts): TokenMap {
  const [size, leading] = HEADLINE[fonts.scale ?? 'standard']
  const labels = fonts.labelCase ?? 'sentence'
  return {
    '--qb-headline-size': size,
    '--qb-headline-leading': leading,
    '--qb-page-title-size': PAGE_TITLE[fonts.scale ?? 'standard'],
    // Tight tracking is for the page headline; smaller headings keep today's.
    '--qb-headline-tracking': fonts.tracking === 'tight' ? '-0.03em' : '-0.02em',
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
    // A primary button in the text colour carries the page's colour as its label.
    '--qb-fill-bg': t.foreground,
    '--qb-fill-ink': t.background,
    // A plain page title's accent phrase, read at 3:1 as large text on the page.
    '--qb-page-accent': solveContrast(t.primary, [t.background], 3) ?? t.foreground,
    '--qb-page-highlight': mixColor(t.primary, t.background, 0.25),
    ...bandTokens(doc, t, mode),
    ...(headerOnBand(doc) ? headerBandTokens(doc, t, mode) : {}),
  }
  Object.assign(tokens, supportTokens(doc, t, mode, tokens))
  Object.assign(
    tokens,
    nameTokens(
      doc,
      t,
      tokens['--qb-header-bg'] ?? t.background,
      tokens['--qb-header-ink'] ?? t.foreground
    )
  )
  tokens['--qb-wordmark-filter'] = wordmarkFilter(
    doc.brand.logo.tone,
    tokens['--qb-header-bg'] ?? t.background
  )
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

const NEAR_BLACK = 'oklch(0.145 0 0)'
const NEAR_WHITE = 'oklch(0.985 0 0)'

/**
 * The first text that reads on every background given: the page's ink, then
 * black or white, then the ink moved in lightness. Null when none can.
 */
function textOn(backgrounds: string[], t: Required<ThemeVariables>): string | null {
  const reads = (text: string) => backgrounds.every((bg) => contrastRatio(text, bg) >= 4.5)
  return (
    [t.foreground, t.background, NEAR_BLACK, NEAR_WHITE].find(reads) ??
    solveContrast(t.foreground, backgrounds, 4.5)
  )
}

/** Why a mode's band cannot carry its headline, if it cannot. */
export function bandError(doc: PortalDesign, vars: ThemeVariables, mode: Mode): string | null {
  const t = vars as Required<ThemeVariables>
  const surface = bandSurface(doc, t, supportColour(doc, mode))
  return surface.behind.every((bg) => contrastRatio(surface.ink, bg) >= 4.5)
    ? null
    : `${mode}: no text reaches 4.5:1 across the band`
}

/** How far a tint band, and the top of a fade, step from the page toward the middle. */
export const BAND_TINT = 0.045
export const BAND_FADE = 0.08

/**
 * The second colour at work: the band's call to action when the design
 * gives it that, and a pale tint for the vote box and the current menu item
 * when the design tints with it. Text on each stays readable.
 */
function supportTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode,
  tokens: TokenMap
): TokenMap {
  const support = supportColour(doc, mode)
  const out: TokenMap = {}
  const action = support && doc.shape.action === 'support' ? support : t.primary
  out['--qb-action-bg'] = action
  out['--qb-action-ink'] =
    action === t.primary ? t.primaryForeground : (textOn([action], t) ?? t.primaryForeground)
  if (support && doc.layout.tint === 'support') {
    out['--qb-support-tint'] = tintOf(support, t.card, 0.06)
    out['--qb-support-edge'] = mixColor(support, t.card, 0.55)
    if (!headerOnBand(doc)) {
      const header = tokens['--qb-header-bg'] ?? t.background
      out['--qb-nav-active-bg'] = tintOf(support, header, 0.07)
      out['--qb-nav-active-ink'] = readableOn(t.foreground, out['--qb-nav-active-bg']!)
    }
  }
  return out
}

/**
 * The name as a wordmark: in the header's text, or in the brand colour moved
 * until it reads on the header, with its accent part in the brand colour too.
 */
function nameTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  header: string,
  ink: string
): TokenMap {
  const { nameColour, nameCase } = doc.brand.logo
  const brand = solveContrast(t.primary, [header], 4.5) ?? ink
  return {
    '--qb-name-ink': nameColour === 'accent' && !headerOnBand(doc) ? brand : ink,
    '--qb-name-accent': solveContrast(t.primary, [header], 3) ?? ink,
    '--qb-name-case': nameCase === 'upper' ? 'uppercase' : 'none',
    '--qb-name-tracking': nameCase === 'upper' ? '0.14em' : 'var(--qb-headline-tracking)',
  }
}

/**
 * A one-colour wordmark redrawn where its ink would vanish into the header:
 * white on a dark header, black on a light one, and as it is otherwise.
 */
function wordmarkFilter(tone: PortalDesign['brand']['logo']['tone'], header: string): string {
  if (!tone) return 'none'
  const dark = contrastRatio(header, '#ffffff') > contrastRatio(header, '#000000')
  if (tone === 'dark' && dark) return 'brightness(0) invert(1)'
  if (tone === 'light' && !dark) return 'brightness(0)'
  return 'none'
}

/** Whether the header takes the band's colour: asked for, and the band has one. */
const headerOnBand = (doc: PortalDesign) =>
  doc.layout.headerOnBand === true && doc.layout.band !== 'none'

/**
 * The header in the band's colour, its text and menu in the band's text. Its
 * button keeps the brand colour where that reads on the band, else takes the
 * band's text colour, so it never vanishes into the band.
 */
function headerBandTokens(doc: PortalDesign, t: Required<ThemeVariables>, mode: Mode): TokenMap {
  const surface = bandSurface(doc, t, supportColour(doc, mode))
  const bg = surface.behind[0]!
  const keepsBrand = contrastRatio(t.primary, bg) >= 3
  const action = keepsBrand ? t.primary : surface.ink
  return {
    '--qb-header-bg': bg,
    '--qb-header-ink': surface.ink,
    '--qb-header-rule': 'transparent',
    '--qb-nav-ink': surface.muted,
    '--qb-nav-active-bg': mixColor(surface.ink, bg, 0.14),
    '--qb-nav-active-ink': surface.ink,
    '--qb-header-action-bg': action,
    '--qb-header-action-ink': keepsBrand ? t.primaryForeground : (textOn([action], t) ?? bg),
  }
}

/** The design's second brand colour in a mode: dark keeps light's unless it sets its own. */
function supportColour(doc: PortalDesign, mode: Mode): string | undefined {
  return mode === 'dark'
    ? (doc.brand.dark?.support ?? doc.brand.light.support)
    : doc.brand.light.support
}

/**
 * The band at the top of a page: plain, a tint of the brand colour, a fade
 * from a tint into the page, the brand colour itself, the second brand
 * colour, or the two blended. Its text stays at 4.5:1 wherever it sits.
 */
function bandTokens(doc: PortalDesign, t: Required<ThemeVariables>, mode: Mode): TokenMap {
  const support = supportColour(doc, mode)
  const surface = bandSurface(doc, t, support)
  return {
    '--qb-band-bg': surface.background,
    '--qb-band-ink': surface.ink,
    '--qb-band-muted': surface.muted,
    // A mesh gives way to the page on phones, where the words cross it.
    ...(surface.narrow ? { '--qb-band-bg-narrow': surface.narrow } : {}),
    // A headline's accent phrase: the brand colour, moved until it reads at
    // 3:1 as large text wherever the headline sits, or the band's ink.
    '--qb-band-accent': solveContrast(t.primary, surface.behind, 3) ?? surface.ink,
    // Over an image, the band's colour veils it so the words keep their contrast.
    '--qb-band-scrim': `color-mix(in oklch, ${surface.behind[0]} 85%, transparent)`,
    '--qb-band-scrim-soft': `color-mix(in oklch, ${surface.behind[0]} 60%, transparent)`,
    // A pale second colour is a highlighter as it is; a deeper one is softened behind the words.
    '--qb-band-highlight':
      support && contrastRatio(surface.ink, support) >= 10
        ? support
        : mixColor(support ?? t.primary, surface.behind[0]!, support ? 0.35 : 0.25),
    ...panelTokens(t, support),
    ...artTokens(doc, t, support),
  }
}

/** How large each tile of a tiled motif is drawn; edge art spans the band. */
const ART_TILE: Record<BandArt, string> = {
  dots: '24px',
  grid: '32px',
  lines: '16px',
  petals: '200px',
  confetti: '160px',
  waves: '100% 120px',
  hills: '100% 120px',
}

/** Band art in the brand colour and the second, when the design draws some and its band has colour. */
function artTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  support: string | undefined
): TokenMap {
  const art = doc.layout.bandArt
  if (!art || art === 'none' || doc.layout.band === 'none') return {}
  return {
    '--qb-band-art': bandArtImage(art, t.primary, support ?? t.primary),
    '--qb-band-art-size': ART_TILE[art],
  }
}

/** A panel the band's words sit on: the second colour, else the card colour. */
function panelTokens(t: Required<ThemeVariables>, support: string | undefined): TokenMap {
  const bg = support ?? t.card
  const ink = textOn([bg], t) ?? t.foreground
  return {
    '--qb-band-panel-bg': bg,
    '--qb-band-panel-ink': ink,
    '--qb-band-panel-muted': solveContrast(t.mutedForeground, [bg], 4.5) ?? ink,
    '--qb-band-panel-accent': solveContrast(t.primary, [bg], 3) ?? ink,
  }
}

interface BandSurface {
  background: string
  /** What the headline sits on. */
  behind: string[]
  ink: string
  muted: string
  narrow?: string
}

function bandSurface(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  support: string | undefined
): BandSurface {
  switch (doc.layout.band) {
    case 'brand':
      return {
        background: t.primary,
        behind: [t.primary],
        ink: t.primaryForeground,
        muted: t.primaryForeground,
      }
    case 'support': {
      const fill = support ?? t.primary
      const ink = support ? (textOn([fill], t) ?? NEAR_BLACK) : t.primaryForeground
      return { background: fill, behind: [fill], ink, muted: ink }
    }
    case 'blend': {
      const second = support ?? mixColor(t.primary, t.background, 0.5)
      if (doc.layout.blend === 'mesh') {
        const middle = mixColor(t.primary, second, 0.5)
        return {
          // Soft colour to the right; the page's own colour under the words.
          background: [
            `linear-gradient(90deg, ${t.background} 34%, transparent 62%)`,
            `radial-gradient(circle at 72% 22%, ${t.primary} 0%, transparent 34%)`,
            `radial-gradient(circle at 94% 34%, ${second} 0%, transparent 36%)`,
            `radial-gradient(circle at 80% 88%, ${middle} 0%, transparent 38%)`,
            t.background,
          ].join(', '),
          behind: [t.background],
          ink: t.foreground,
          muted: t.mutedForeground,
          narrow: t.background,
        }
      }
      const behind = [t.primary, mixColor(t.primary, second, 0.5)]
      // With no text that reads across the line, the ink at its start stays and the design is refused.
      const ink = textOn(behind, t) ?? textOn([t.primary], t) ?? NEAR_BLACK
      return {
        background: `linear-gradient(110deg, ${t.primary} 0%, ${second} 100%)`,
        behind,
        ink,
        muted: ink,
      }
    }
    case 'tint': {
      const tint = tintOf(t.primary, t.background, BAND_TINT)
      return {
        background: tint,
        behind: [tint],
        ink: readableOn(t.foreground, tint),
        muted: readableOn(t.mutedForeground, tint),
      }
    }
    case 'fade': {
      const top = tintOf(t.primary, t.background, BAND_FADE)
      return {
        background: `linear-gradient(to bottom, ${top}, ${t.background})`,
        behind: [top],
        ink: readableOn(t.foreground, top),
        muted: readableOn(t.mutedForeground, top),
      }
    }
    default:
      return {
        background: 'transparent',
        behind: [t.background],
        ink: t.foreground,
        muted: t.mutedForeground,
      }
  }
}

/** Size tokens, the same in both modes. */
export function baseTokens(doc: PortalDesign): TokenMap {
  const [control, field, panel] = RADII[doc.shape.corners]
  const buttons = doc.shape.buttons ?? 'match'
  const [button, composer] = buttons === 'match' ? [control, field] : BUTTON_RADII[buttons]
  const [padding, gap, title] = DENSITY[doc.layout.density]
  return {
    '--qb-radius-control': control,
    '--qb-radius-field': field,
    '--qb-radius-panel': panel,
    '--qb-radius-button': button,
    '--qb-radius-composer': composer,
    '--qb-nav-radius': doc.layout.nav === 'pills' ? '999px' : 'calc(var(--radius) * 0.8)',
    '--qb-card-padding': padding,
    // List cards run together, divided by their rules.
    '--qb-feed-gap': doc.layout.cards === 'list' ? '0rem' : gap,
    '--qb-title-size': title,
    '--qb-page-max': PAGE_MAX[doc.layout.width],
    '--qb-image-focus': { left: 'left', centre: 'center', right: 'right' }[
      doc.layout.imageFocus ?? 'centre'
    ],
    // Focused to one side, a side image crops to a portrait in a narrower column.
    '--qb-image-aspect': (doc.layout.imageFocus ?? 'centre') === 'centre' ? '4 / 3' : '4 / 5',
    '--qb-image-column': (doc.layout.imageFocus ?? 'centre') === 'centre' ? '0.85fr' : '0.55fr',
    '--qb-font-body': fontStack(doc.brand.fonts.body),
    '--qb-font-heading': fontStack(doc.brand.fonts.heading),
    '--qb-font-display': fontStack(doc.brand.fonts.display ?? doc.brand.fonts.heading),
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
    'data-qb-band-align': doc.layout.bandAlign ?? (header === 'centered' ? 'centre' : 'left'),
    'data-qb-band-shape': doc.layout.bandShape ?? 'full',
    'data-qb-header-band': headerOnBand(doc) ? 'on' : 'off',
    'data-qb-status': doc.layout.status ?? 'colour',
    // In the brand colour, a headline takes the band's accent, read where the headline sits.
    'data-qb-headline': doc.brand.fonts.headlineColour === 'accent' ? 'accent' : 'ink',
    // Titles go on the band only where there is one.
    'data-qb-page-titles': doc.layout.pageTitles === 'band' && band !== 'none' ? 'band' : 'plain',
    // An image behind the words takes the band's place; art beside a side image stays.
    'data-qb-band-art':
      !doc.layout.bandArt ||
      doc.layout.bandArt === 'none' ||
      band === 'none' ||
      (doc.brand.bandImage && (doc.layout.imagePlace ?? 'side') !== 'side')
        ? 'none'
        : EDGE_ART.has(doc.layout.bandArt)
          ? 'edge'
          : 'tile',
    'data-qb-tint':
      doc.layout.tint === 'support' && doc.brand.light.support ? 'support' : 'neutral',
    'data-qb-cards': cards,
    'data-qb-fill': doc.shape.fill ?? 'accent',
    'data-qb-filters': filters,
  }
}
