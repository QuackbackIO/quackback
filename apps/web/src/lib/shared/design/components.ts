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
import { tuneHexes, tuneTokens } from './tune'
import { bandArtImage, EDGE_ART, type BandArt } from './band-art'
import { CLEAN_EDGE, fadesIntoPage, glowFoot, softFoot, type BandFoot } from './band-foot'
import { meshBand } from './band-glow'
import { blendHue, mixColor, tintOf } from './color'
import { clearerInk, contrastRatio, isLight, overlay, solveContrast } from './contrast'
import { fontStack, wordGap } from './fonts'
import { roleFill, roleTokens, textOn } from './colour-roles'
import { votedInk } from './voted'
import { LOGO_FILTER } from './logo'
import { pageChoiceAttributes } from './page-choices'
import { drawFill, fillFor, hasPageBackground, type BackgroundPage } from './page-background'
import type { DESIGN_OPTIONS } from './options'
import type { PortalDesign } from './schema'
import { accentRoleTokens, wordsColourTokens, type AccentGround } from './words-colour'

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

const SUBTITLE: Record<NonNullable<Fonts['scale']>, string> = {
  standard: '1rem',
  large: '1.125rem',
  display: 'clamp(1.0625rem, 0.95rem + 0.4vw, 1.3125rem)',
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
    // A headline's line grows with it, so it never reads as a caption under a poster.
    '--qb-subtitle-size': SUBTITLE[fonts.scale ?? 'standard'],
    // Tight tracking is for the page headline; smaller headings keep today's.
    '--qb-headline-tracking': fonts.tracking === 'tight' ? '-0.03em' : '-0.02em',
    '--qb-headline-case': CASE[fonts.headlineCase ?? 'sentence'],
    // However a brand sizes it, a headline leads: well above the cards' titles and its own
    // subtitle, and short of a poster that fills the first screen.
    '--qb-headline-floor':
      'max(clamp(1.875rem, 1.45rem + 1.4vw, 2.5rem), calc(var(--qb-subtitle-size, 1rem) * 1.4))',
    '--qb-headline-cap': '7.5rem',
    // How many of its widths a line holds for each letter, so a long headline drops in size
    // rather than run past two or three lines (the hero sizes it by its own length).
    // Capitals are wider.
    '--qb-headline-measure': fonts.headlineCase === 'upper' ? '3.4' : '4.2',
    '--qb-label-case': CASE[labels],
    // Upper-case labels read better spaced out.
    '--qb-label-tracking': labels === 'upper' ? '0.06em' : '0em',
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
    // The other pages: the softer grey, or the text colour as most brands' menus are.
    '--qb-nav-ink': doc.layout.navText === 'ink' ? t.foreground : t.mutedForeground,
    '--qb-nav-active-bg': t.muted,
    '--qb-nav-active-ink': t.foreground,
    '--qb-vote-active': votedInk(t),
    // A primary button in the text colour carries the page's colour as its label.
    '--qb-fill-bg': t.foreground,
    '--qb-fill-ink': t.background,
    // A plain page title's accent phrase, read at 3:1 as large text on the page.
    '--qb-page-accent': solveContrast(t.primary, [t.background], 3) ?? t.foreground,
    '--qb-page-highlight': mixColor(t.primary, t.background, 0.25),
    // A vote box's only edge, at 3:1 on cards and the page.
    '--qb-vote-edge': solveContrast(t.input, [t.card, t.background], 3) ?? t.foreground,
    ...bandTokens(doc, onGround(doc, t, mode), mode),
    ...(headerOnBand(doc) ? headerBandTokens(doc, onGround(doc, t, mode), mode) : {}),
  }
  tokens['--qb-header-focus'] = focusOn(t, [tokens['--qb-header-bg']!], tokens['--qb-header-ink']!)
  Object.assign(tokens, supportTokens(doc, t, mode, tokens), roleTokens(doc, t, mode))
  Object.assign(tokens, logoTokens(doc.brand.logo, tokens['--qb-header-bg'] ?? t.background, mode))
  // Words and headline accents in a colour role, for the roles the design colours words in.
  Object.assign(
    tokens,
    accentRoleTokens(doc, t, mode, accentGround(doc, onGround(doc, t, mode), mode)),
    wordsColourTokens(doc, t, mode)
  )
  // The underline under the current page comes from the data-qb-nav attribute.
  if (doc.layout.nav === 'underline' || doc.layout.nav === 'plain')
    tokens['--qb-nav-active-bg'] = 'transparent'
  if (doc.layout.nav === 'pills') {
    // The solver keeps accent text readable on the subtle accent.
    tokens['--qb-nav-active-bg'] = t.accent
    tokens['--qb-nav-active-ink'] = t.accentInk
  }
  return tokens
}

/**
 * A mode's colours with the page as the hero sees it: under a page
 * background, the colour along the page's top, so a tint or fade hero is
 * drawn from the page it sits on and its words are read there.
 */
function onGround(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode
): Required<ThemeVariables> {
  if (!hasPageBackground(doc)) return t
  const ground = { page: t.background, ink: t.foreground, accent: t.primary }
  const top = drawFill(doc, fillFor(doc, null, mode), ground, mode).top
  return top === t.background ? t : { ...t, background: top }
}

/** The focus ring moved until it reads at 3:1 on the colours given, else the ink drawn on them. */
const focusOn = (t: Required<ThemeVariables>, backgrounds: string[], ink: string) =>
  solveContrast(t.ring, backgrounds, 3) ?? ink

/** Text readable on a background, moved in lightness only if it has to be. */
const readableOn = (ink: string, background: string) => solveContrast(ink, [background], 4.5) ?? ink

const NEAR_BLACK = 'oklch(0.145 0 0)'
const NEAR_WHITE = 'oklch(0.985 0 0)'

/**
 * The band's headline text, the colour behind it that it reads worst on, and
 * the contrast it needs, or null with no band. A light headline on a bright
 * band reads as large text, at 3:1 (bandWords).
 */
export function bandContrast(
  doc: PortalDesign,
  vars: ThemeVariables,
  mode: Mode
): { ink: string; background: string; target: number } | null {
  if (doc.layout.band === 'none') return null
  const t = vars as Required<ThemeVariables>
  const surface = bandSurface(doc, t, mode)
  const words = bandWords(doc, t, surface)
  const ink = words?.headline ?? surface.ink
  const background = surface.behind.reduce((worst, bg) =>
    contrastRatio(ink, bg) < contrastRatio(ink, worst) ? bg : worst
  )
  return background ? { ink, background, target: words ? 3 : 4.5 } : null
}

/** WCAG's large text: 18.66px (14pt) bold, or 24px (18pt) at any weight. */
const LARGE_BOLD = '1.1667rem'
const LARGE_ANY = '1.5rem'

/**
 * The headline and subtitle on a band of one colour that the band's dark
 * text passes 4.5:1 on, where light text reads clearer by APCA but reaches
 * only 3:1: the headline is large text, so it takes the light text, and the
 * subtitle follows it, set large (18.66px bold), so the two stay one. The
 * subtitle is body text otherwise, so this holds only where the site's own
 * subtitle was light; else both stay dark. Null where the words stay as the
 * band draws them, as on a panel or an image. The band's other text and its
 * buttons keep 4.5:1.
 */
function bandWords(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  surface: BandSurface
): { headline: string; subtitle: string; large: boolean } | null {
  if (doc.layout.band !== 'brand' && doc.layout.band !== 'support') return null
  if ((doc.layout.bandShape ?? 'full') === 'panel' || doc.brand.bandImage) return null
  const light = [t.background, t.foreground, NEAR_WHITE, '#ffffff'].filter(isLight)
  const headline = clearerInk(surface.ink, surface.behind, light, 3)
  if (headline === surface.ink) return null
  const reads = (ink: string) => surface.behind.every((bg) => contrastRatio(ink, bg) >= 4.5)
  const body = light.find(reads)
  if (body) return { headline, subtitle: body, large: false }
  const site = tuneHexes(doc)?.subtitle?.colour
  if (!site || !isLight(site)) return null
  return { headline, subtitle: headline, large: true }
}

/** A subtitle set as large text: bold at 18.66px, or 24px where the tune sets a lighter weight, which wins. */
function largeSubtitle(doc: PortalDesign): TokenMap {
  const weight = doc.tune?.subtitle?.weight
  if (weight !== undefined && weight < 700)
    return { '--qb-band-subtitle-size': `max(var(--qb-subtitle-size, 1rem), ${LARGE_ANY})` }
  return {
    '--qb-band-subtitle-size': `max(var(--qb-subtitle-size, 1rem), ${LARGE_BOLD})`,
    '--qb-band-subtitle-weight': '700',
  }
}

/** The tokens for the band's headline and subtitle, where bandWords turns them. */
function bandWordsTokens(doc: PortalDesign, t: Required<ThemeVariables>, surface: BandSurface) {
  const words = bandWords(doc, t, surface)
  if (!words) return {}
  return {
    '--qb-band-headline': words.headline,
    '--qb-band-subtitle': words.subtitle,
    ...(words.large ? largeSubtitle(doc) : {}),
  }
}

/** The colours a band's headline sits on, in a mode: the page's under a mesh, the top tint of a fade. */
export function headlineBehind(doc: PortalDesign, vars: ThemeVariables, mode: Mode): string[] {
  if (doc.layout.band === 'none') return []
  return bandSurface(doc, vars as Required<ThemeVariables>, mode).behind
}

/** Why a mode's band cannot carry its headline, if it cannot. */
export function bandError(doc: PortalDesign, vars: ThemeVariables, mode: Mode): string | null {
  const t = vars as Required<ThemeVariables>
  const surface = bandSurface(doc, t, mode)
  if (!surface.behind.every((bg) => contrastRatio(surface.ink, bg) >= 4.5))
    return `${mode}: no text reaches 4.5:1 across the hero`
  return photoError(doc, mode)
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
    const edge = mixColor(support, t.card, 0.55)
    out['--qb-support-edge'] = solveContrast(edge, [t.card, t.background], 3) ?? edge
    if (!headerOnBand(doc)) {
      const header = tokens['--qb-header-bg'] ?? t.background
      out['--qb-nav-active-bg'] = tintOf(support, header, 0.07)
      out['--qb-nav-active-ink'] = readableOn(t.foreground, out['--qb-nav-active-bg']!)
    }
  }
  return out
}

/** Under this contrast with the header, a logo of one ink is lost in it. */
const OWN_COLOUR = 2

/**
 * A logo image where its ink would vanish into the header: a dark logo over
 * a dark header, a light one over a light header. A logo of one ink is drawn
 * reversed, in the header's text colour; one of several colours keeps its
 * colours, only its vanishing ink turned over, so it never sits on a plate
 * and is never inverted. A coloured logo of one ink on a header of its own
 * colour (a band in the brand's colour) is drawn in the header's text. A logo
 * not measured, and a dark mode logo of the design's own, sit as they are.
 */
function logoTokens(logo: PortalDesign['brand']['logo'], header: string, mode: Mode): TokenMap {
  const { tone } = logo
  const shown = logo.display === 'wordmark' ? logo.wordmark : logo.mark
  const dark = contrastRatio(header, '#ffffff') > contrastRatio(header, '#000000')
  const vanishes = (tone === 'dark' && dark) || (tone === 'light' && !dark)
  const own = mode === 'dark' && !!shown.dark
  const lost = logo.oneInk === true && !!logo.ink && contrastRatio(logo.ink, header) < OWN_COLOUR
  const filter = own
    ? null
    : vanishes
      ? logo.oneInk === true
        ? LOGO_FILTER.reverse
        : dark
          ? LOGO_FILTER.lift
          : LOGO_FILTER.sink
      : lost
        ? LOGO_FILTER.ink
        : null
  return { '--qb-logo-filter': filter ? `url(#${filter})` : 'none' }
}

/**
 * The current page's pill on a surface: a step towards its text, as a lit
 * tab is; on a mid tone, where that step would leave the text under 4.5:1, a
 * step away from it instead, deep enough that the text reads.
 */
function activePill(ink: string, surface: string): string {
  const toward = mixColor(ink, surface, 0.14)
  if (contrastRatio(ink, toward) >= 4.5) return toward
  const away = contrastRatio(ink, '#000000') > contrastRatio(ink, '#ffffff') ? '#000000' : '#ffffff'
  for (let share = 0.14; share < 1; share += 0.02) {
    const pill = mixColor(away, surface, share)
    if (contrastRatio(ink, pill) >= 4.5) return pill
  }
  return away
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
  const shade = headerOverPhoto(doc) ? photoShade(doc) : null
  // On the photo, the header reads on the photo's worst colour under its veil.
  const surface: BandSurface = shade
    ? {
        ...bandSurface(doc, t, mode),
        behind: [shade.under],
        ink: SHADE_INK[shade.tone],
        muted: SHADE_INK[shade.tone],
      }
    : bandSurface(doc, t, mode)
  const span = headerSpans(doc) ? spanSurface(surface, t) : null
  const bg = span ? span.under : surface.behind[0]!
  const ink = span?.ink ?? surface.ink
  const keepsBrand = contrastRatio(t.primary, bg) >= 3
  const action = keepsBrand ? t.primary : ink
  return {
    '--qb-header-bg': bg,
    '--qb-header-ink': ink,
    '--qb-header-rule': 'transparent',
    '--qb-nav-ink': span || doc.layout.navText === 'ink' ? ink : surface.muted,
    '--qb-nav-active-bg': activePill(ink, bg),
    '--qb-nav-active-ink': ink,
    '--qb-header-action-bg': action,
    '--qb-header-action-ink': keepsBrand ? t.primaryForeground : (textOn([action], t) ?? bg),
    ...(headerOverPhoto(doc) ? { '--qb-header-veil': shadeVeil(doc, HEADER_VEIL)! } : {}),
    ...(span
      ? {
          // One background behind the header and the band, sized over both (portal-header, portal-band).
          '--qb-header-surface': span.background,
          '--qb-header-surface-narrow': span.narrow,
          '--qb-band-bg': span.background,
          ...(surface.narrow ? { '--qb-band-bg-narrow': span.narrow } : {}),
        }
      : {}),
  }
}

/**
 * A header on the hero's photo: the image runs up behind the header (the
 * band places it, portal-band), under a deeper veil so the menu reads, as a
 * site whose header sits on its hero photo. Only a full band showing a
 * measured, veiled image behind the words.
 */
export const headerOverPhoto = (doc: PortalDesign) =>
  headerOnBand(doc) &&
  (doc.layout.bandShape ?? 'full') === 'full' &&
  !doc.brand.bandImage?.homeOnly &&
  photoShade(doc) !== null

/** How much deeper the veil is behind the header than behind the words, percent. */
const HEADER_VEIL = 15

/**
 * A gradient band whose header sits on it: one surface behind both, the band
 * running up behind the header (a site's hero gradient reaching its header,
 * as a chat app's and a payments site's do). Only a full band of a gradient, with no image
 * or art, which keep their own placement.
 */
export const headerSpans = (doc: PortalDesign) =>
  headerOnBand(doc) &&
  (doc.layout.band === 'blend' || doc.layout.band === 'fade') &&
  (doc.layout.bandShape ?? 'full') === 'full' &&
  !doc.brand.bandImage &&
  (!doc.layout.bandArt || doc.layout.bandArt === 'none')

/**
 * The shared surface and the header's text on it: a text that reads on every
 * colour across the band's top; where none does, the page's colour holds
 * under the header and fades into the band below it, so the header still
 * reads and the surface has no step.
 */
function spanSurface(
  surface: BandSurface,
  t: Required<ThemeVariables>
): { background: string; narrow: string; ink: string; under: string } {
  const across = surface.across ?? surface.behind
  const ink = textOn(across, t)
  const narrow = surface.narrow ?? surface.background
  if (ink) {
    // The header's worst colour, for its focus ring and logo.
    const under = across.reduce((worst, bg) =>
      contrastRatio(ink, bg) < contrastRatio(ink, worst) ? bg : worst
    )
    return { background: surface.background, narrow, ink, under }
  }
  // Glows on the page's own colour fade in under the header. A gradient of other
  // colours starts on a clean edge: the page's colour faded over it muddies both.
  const glows = surface.glows === true
  const hold = `linear-gradient(to bottom, ${t.background} var(--portal-header-height, 0px), transparent ${glows ? 'calc(var(--portal-header-height, 0px) + 5rem)' : 'var(--portal-header-height, 0px)'})`
  return {
    background: `${hold}, ${surface.background}`,
    narrow: surface.narrow ? narrow : `${hold}, ${narrow}`,
    ink: readableOn(t.foreground, t.background),
    under: t.background,
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
  const surface = bandSurface(doc, t, mode)
  return {
    '--qb-band-bg': surface.background,
    // Set wherever the band says it glows from its foot, so a title band's colour is always there.
    ...(layoutAttributes(doc)['data-qb-band-glow'] === 'foot'
      ? { '--qb-band-plain': surface.plain ?? surface.background }
      : {}),
    '--qb-band-ink': surface.ink,
    '--qb-band-muted': surface.muted,
    ...bandWordsTokens(doc, t, surface),
    // The focus ring on the band, and on the words' panel when they sit on one.
    '--qb-band-focus': focusOn(
      t,
      doc.layout.band !== 'none' && doc.layout.bandShape === 'panel'
        ? [...surface.behind, support ?? t.card]
        : surface.behind,
      surface.ink
    ),
    // A mesh's own composition on phones, its glows in the corners, veiled for the words that cross them.
    ...(surface.narrow ? { '--qb-band-bg-narrow': surface.narrow } : {}),
    ...footTokens(doc, t, surface, mode),
    // A headline's accent phrase: the brand colour, moved until it reads at
    // 3:1 as large text wherever the headline sits, or the band's ink.
    '--qb-band-accent': solveContrast(t.primary, surface.behind, 3) ?? surface.ink,
    // Over an image, its measured veil, else the band's colour, keeps the words' contrast.
    // Unmeasured, the veil is deep enough that the words read over any image.
    '--qb-band-scrim':
      shadeVeil(doc) ?? veilOf(surface.behind[0]!, [surface.ink, surface.muted], 0.85),
    '--qb-band-scrim-soft': veilOf(surface.behind[0]!, [surface.ink, surface.muted], 0.6),
    // A pale second colour is a highlighter as it is; a deeper one is softened behind the words.
    '--qb-band-highlight':
      support && contrastRatio(surface.ink, support) >= 10
        ? support
        : mixColor(support ?? t.primary, surface.behind[0]!, support ? 0.35 : 0.25),
    ...panelTokens(t, support),
    ...artTokens(doc, t, support),
    ...photoTokens(doc, t),
  }
}

/** The modes a design shows. */
const shownModes = (doc: PortalDesign): Mode[] =>
  doc.mode === 'light' ? ['light'] : doc.mode === 'dark' ? ['dark'] : ['light', 'dark']

/** Whether a mode's pages are one colour under the band: their own, or a wash of one. */
function onePageColour(doc: PortalDesign, mode: Mode): boolean {
  const uniform = (kind: string) => kind === 'solid' || kind === 'tint'
  const pages = Object.keys(doc.layout.pageBackgrounds ?? {}) as BackgroundPage[]
  return [null, ...pages].every((page) => uniform(fillFor(doc, page, mode).kind))
}

/**
 * The band's foot (band-foot.ts). Glows on the page's own colour (a mesh, a
 * ribbon) fade back into the page before the band ends, and in from it under
 * a header in the page's colour. A band of colour fades into the page where
 * the two are near or of one hue, or where it is a gradient; one far from the
 * page (lime or orange on white) keeps its clean edge, as a site's coloured
 * section does. A fade band already ends in the page. Bands set in a panel
 * (inset, split) end at the panel's rounded edge. Over a wash the band fades
 * into the wash's colour; over a gradient, image or pattern, where no one
 * colour lies under it, the band itself fades out over its bottom padding.
 */
function footTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  surface: BandSurface,
  mode: Mode
): TokenMap {
  // All set in every mode with a band, so one mode's foot never carries into the other's.
  const foot = ({ paint, pad, fadeOut }: BandFoot): TokenMap => ({
    '--qb-band-foot': paint,
    '--qb-band-foot-pad': pad,
    '--qb-band-fade-out': fadeOut ? 'transparent' : 'black',
  })
  const { band } = doc.layout
  const shape = doc.layout.bandShape ?? 'full'
  if (band === 'none') return {}
  if (band === 'fade' || shape === 'inset' || shape === 'split') return foot(CLEAN_EDGE)
  const blend = doc.layout.blend ?? 'linear'
  const glows = band === 'blend' && blend !== 'linear'
  const gradient = band === 'blend'
  if (!gradient && !fadesIntoPage(surface.behind, t.background)) return foot(CLEAN_EDGE)
  // Over a page of more than one colour, the band itself fades out under its words, onto whatever lies there.
  if (!onePageColour(doc, mode)) return foot({ ...CLEAN_EDGE, fadeOut: true })
  if (glows) return foot({ ...CLEAN_EDGE, paint: glowFoot(t.background, !headerSpans(doc)) })
  return foot(softFoot(t.background, [surface.ink, surface.muted]))
}

/**
 * A veil of the band's colour over an image the design has not measured: at
 * least `least` of it, and as much more as every text needs to keep 4.5:1
 * whatever the image holds, tried over its extremes, black and white.
 */
function veilOf(colour: string, inks: string[], least: number): string {
  const reads = (share: number) =>
    ['#000000', '#ffffff'].every((pixel) => {
      const behind = overlay(colour, pixel, share)
      return inks.every((ink) => contrastRatio(ink, behind) >= 4.5)
    })
  let percent = Math.round(least * 100)
  while (percent < 100 && !reads(percent / 100)) percent += 1
  return `color-mix(in oklch, ${colour} ${percent}%, transparent)`
}

/** A measured veil over the hero image, as a colour; `more` deepens it (under a header on the image). */
function shadeVeil(doc: PortalDesign, more = 0): string | null {
  const shade = photoShade(doc)
  if (!shade) return null
  const strength = Math.min(95, shade.strength + more)
  return shade.tone === 'dark' ? `rgb(0 0 0 / ${strength}%)` : `rgb(255 255 255 / ${strength}%)`
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

/** What a headline accent may sit on: the band, the panel its words may sit on, a veiled photo. */
function accentGround(doc: PortalDesign, t: Required<ThemeVariables>, mode: Mode): AccentGround {
  const surface = bandSurface(doc, t, mode)
  const bg = supportColour(doc, mode) ?? t.card
  const shade = photoShade(doc)
  return {
    behind: surface.behind,
    ink: surface.ink,
    panel: { bg, ink: textOn([bg], t) ?? t.foreground },
    photo: shade ? { under: shade.under, ink: SHADE_INK[shade.tone] } : null,
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
  /** Every colour across the band's top, where a header sharing it sits. */
  across?: string[]
  /** Glows on the page's own colour (a mesh, a ribbon), rather than a field of colour. */
  glows?: true
  /** A lit band's colour without its glow, for a short title band whose words sit low. */
  plain?: string
}

/**
 * The veil over a hero image behind the words, when the design measured one
 * for its image (a brand match does): the image is shown behind the words on
 * phones too, on a full band (inset, panel and split move the words off it).
 */
export function photoShade(
  doc: PortalDesign
): NonNullable<NonNullable<PortalDesign['brand']['bandImage']>['shade']> | null {
  const image = doc.brand.bandImage
  if (!image?.shade || doc.layout.band === 'none') return null
  if ((doc.layout.imagePlace ?? 'side') !== 'cover') return null
  if ((doc.layout.imagePhone ?? 'show') === 'hide') return null
  const shape = doc.layout.bandShape ?? 'full'
  return shape === 'full' ? image.shade : null
}

/** The words over a veiled image: white on a dark veil, near black on a light one. */
const SHADE_INK = { dark: '#ffffff', light: '#111111' } as const

/**
 * The words over a veiled photo, where the band draws it (portal-band sets
 * them on the band then): they read on the photo's worst colour, measured.
 * Elsewhere (another page, the post page, a phone leaving it off) the band's
 * own colour and its own words stand.
 */
function photoTokens(doc: PortalDesign, t: Required<ThemeVariables>): TokenMap {
  const shade = photoShade(doc)
  if (!shade) return {}
  const ink = SHADE_INK[shade.tone]
  return {
    '--qb-photo-ink': ink,
    '--qb-photo-muted': ink,
    '--qb-photo-accent': solveContrast(t.primary, [shade.under], 3) ?? ink,
  }
}

/** Why a veiled photo cannot carry the words, if it cannot. */
function photoError(doc: PortalDesign, mode: Mode): string | null {
  const shade = photoShade(doc)
  if (!shade || contrastRatio(SHADE_INK[shade.tone], shade.under) >= 4.5) return null
  return `${mode}: no text reaches 4.5:1 on the hero photo`
}

/**
 * A band of the brand colour. In dark mode, where the design sets no dark
 * brand colour, a dark brand colour stays itself, as in light mode, with the
 * page's light words on it: the lighter colour dark mode works out for
 * buttons and links to read on the page would turn the band into a loud slab.
 */
function brandBand(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode,
  own: { fill: string; ink: string }
): { fill: string; ink: string } {
  const role = doc.layout.bandColour
  if (mode !== 'dark' || doc.brand.dark?.accent || (role && role !== 'accent')) return own
  const light = doc.brand.light.accent
  return contrastRatio(t.foreground, light) >= 4.5 ? { fill: light, ink: t.foreground } : own
}

/** Where a band's glow is centred, and how far it reaches across and up (its ellipse's radii). */
const GLOW_PLACE: Record<Exclude<(typeof DESIGN_OPTIONS.bandGlow)[number], 'none'>, string> = {
  bottom: 'ellipse 38% 60% at 50% 100%',
  top: 'ellipse 38% 60% at 50% 0%',
  corner: 'ellipse 45% 80% at 100% 0%',
}

/**
 * How strongly the glow's colour shows around its edge: the strongest at
 * which every ink on it still reads, else no glow.
 */
const GLOW_EDGE = [0.45, 0.3, 0.15]

/**
 * A solid band lit by a soft glow (rising from its foot, along its top, or
 * in a corner): a light core in the glow's colour, fading out into the
 * band's own. The band's text and buttons keep 4.5:1 on its edge. Rising
 * from the foot, it sits under the composer, below the words, so the words
 * read on the band's own colour; along the top or in a corner it meets
 * them, so their inks (bandWords: the headline at 3:1 as large text, the
 * subtitle at 3:1 set large, else 4.5:1) must read on its edge too.
 */
function lit(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode,
  band: BandSurface
): BandSurface {
  const at = doc.layout.bandGlow
  if (!at || at === 'none') return band
  const fill = band.background
  const role = doc.layout.bandGlowColour
  const glow = role ? roleFill(doc, t, mode, role).fill : mixColor('#ffffff', fill, 0.6)
  const inks: Array<[string, number]> = [
    [band.ink, 4.5],
    [band.muted, 4.5],
  ]
  if (at !== 'bottom') {
    const words = bandWords(doc, t, band)
    if (words) inks.push([words.headline, 3], [words.subtitle, words.large ? 3 : 4.5])
  }
  const edge = GLOW_EDGE.find((share) => {
    const under = mixColor(glow, fill, share)
    return inks.every(([ink, target]) => contrastRatio(ink, under) >= target)
  })
  if (edge === undefined) return band
  const core = mixColor('#ffffff', glow, 0.35)
  const rim = mixColor(glow, fill, edge)
  return {
    ...band,
    background: `radial-gradient(${GLOW_PLACE[at]}, ${core} 0%, ${glow} 22%, ${rim} 50%, transparent 80%), ${fill}`,
    behind: at === 'bottom' ? band.behind : [...band.behind, rim],
    plain: fill,
  }
}

function bandSurface(doc: PortalDesign, t: Required<ThemeVariables>, mode: Mode): BandSurface {
  const support = supportColour(doc, mode)
  // The colour a brand-colour, tint or fade band is drawn in.
  const own = roleFill(doc, t, mode, doc.layout.bandColour)
  switch (doc.layout.band) {
    case 'brand': {
      const { fill, ink } = brandBand(doc, t, mode, own)
      return lit(doc, t, mode, { background: fill, behind: [fill], ink, muted: ink })
    }
    case 'support': {
      const fill = support ?? t.primary
      const ink = support ? (textOn([fill], t) ?? NEAR_BLACK) : t.primaryForeground
      return lit(doc, t, mode, { background: fill, behind: [fill], ink, muted: ink })
    }
    case 'blend': {
      // The brand colour runs into the hero colour where one is chosen, else the second.
      const chosen = doc.layout.bandColour && doc.layout.bandColour !== 'accent' ? own.fill : null
      const second = chosen ?? support ?? mixColor(t.primary, t.background, 0.5)
      const centred = (doc.layout.bandAlign ?? 'left') === 'centre'
      if (doc.layout.blend === 'mesh') {
        // Soft colour beside the words, or around centred ones; the page's own colour under them (band-glow).
        const mesh = meshBand(
          {
            page: t.background,
            ink: t.foreground,
            muted: t.mutedForeground,
            primary: t.primary,
            second,
          },
          centred
        )
        return {
          background: mesh.background,
          behind: mesh.behind,
          ink: t.foreground,
          muted: t.mutedForeground,
          narrow: mesh.narrow,
          across: mesh.across,
          glows: true,
        }
      }
      if (doc.layout.blend === 'ribbon') {
        // A ribbon sweeping down past the words, kept clear of them: further right
        // for centred words, with the page's own colour faded in under them. Its
        // edges fade over a wide span, soft rather than a hard stripe.
        const at = centred ? 60 : 46
        const stop = (colour: string, offset: number) => `${colour} ${Math.min(100, at + offset)}%`
        const ribbon = [
          stop(t.background, 0),
          stop(mixColor(t.primary, t.background, 0.8), 7),
          stop(mixColor(t.primary, t.background, 0.4), 13),
          stop(t.primary, 19),
          stop(blendHue(t.primary, second, 0.5), 24),
          stop(second, 29),
          stop(mixColor(second, t.background, 0.4), 36),
          stop(mixColor(second, t.background, 0.8), 42),
          stop(t.background, 48),
        ]
        return {
          background: [
            `linear-gradient(90deg, ${t.background} ${centred ? 62 : 38}%, transparent ${centred ? 74 : 54}%)`,
            `linear-gradient(in oklab 62deg, ${ribbon.join(', ')})`,
          ].join(', '),
          behind: [t.background],
          ink: t.foreground,
          muted: t.mutedForeground,
          narrow: t.background,
          across: [t.background, t.primary, blendHue(t.primary, second, 0.5), second],
          glows: true,
        }
      }
      // Mixed in oklab through the vivid colour between the two (blendHue), as a
      // browser's sRGB mix of two near-opposite hues greys where they meet.
      const between = blendHue(t.primary, second, 0.5)
      const behind = [t.primary, between]
      // With no text that reads across the line, the ink at its start stays and the design is refused.
      const ink = textOn(behind, t) ?? textOn([t.primary], t) ?? NEAR_BLACK
      return {
        background: `linear-gradient(in oklab 110deg, ${t.primary} 0%, ${between} 50%, ${second} 100%)`,
        behind,
        ink,
        muted: ink,
        across: [...behind, second],
      }
    }
    case 'tint': {
      const tint = tintOf(own.fill, t.background, BAND_TINT)
      return {
        background: tint,
        behind: [tint],
        ink: readableOn(t.foreground, tint),
        muted: readableOn(t.mutedForeground, tint),
      }
    }
    case 'fade': {
      const top = tintOf(own.fill, t.background, BAND_FADE)
      // From the foot, the words sit where the page's colour meets the tint.
      const fromFoot = doc.layout.fadeFrom === 'bottom'
      return {
        // Over a page background, the fade runs into it rather than into the page colour.
        background: `linear-gradient(${fromFoot ? 'to top' : 'to bottom'}, ${top}, ${hasPageBackground(doc) ? 'transparent' : t.background})`,
        behind: fromFoot ? [t.background, top] : [top],
        ink: readableOn(t.foreground, top),
        muted: readableOn(t.mutedForeground, top),
        across: [top, t.background],
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
    // Headlines take the heading weight unless the design tunes their own.
    '--qb-headline-weight': String(doc.brand.fonts.headingWeight),
    ...(doc.brand.logo.height ? { '--qb-logo-height': `${doc.brand.logo.height / 16}rem` } : {}),
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
    '--qb-image-focus': doc.layout.imagePoint
      ? `${doc.layout.imagePoint.x}% ${doc.layout.imagePoint.y}%`
      : { left: 'left', centre: 'center', right: 'right' }[doc.layout.imageFocus ?? 'centre'],
    // Focused to one side, a side image crops to a portrait in a narrower column.
    '--qb-image-aspect': (doc.layout.imageFocus ?? 'centre') === 'centre' ? '4 / 3' : '4 / 5',
    '--qb-image-column': (doc.layout.imageFocus ?? 'centre') === 'centre' ? '0.85fr' : '0.55fr',
    '--qb-font-body': fontStack(doc.brand.fonts.body),
    '--qb-font-heading': fontStack(doc.brand.fonts.heading),
    '--qb-font-display': fontStack(doc.brand.fonts.display ?? doc.brand.fonts.heading),
    '--qb-heading-weight': String(doc.brand.fonts.headingWeight),
    // Each face's word space, so a narrow one set tight is widened to read.
    '--qb-body-space': wordGap(doc.brand.fonts.body),
    '--qb-heading-space': wordGap(doc.brand.fonts.heading),
    '--qb-display-space': wordGap(doc.brand.fonts.display ?? doc.brand.fonts.heading),
    ...typeTokens(doc.brand.fonts),
    ...tuneTokens(doc.tune),
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
    // A split panel needs a side image to split with; without one it is a panel within the page.
    'data-qb-band-shape':
      doc.layout.bandShape === 'split' &&
      !(doc.brand.bandImage && (doc.layout.imagePlace ?? 'side') === 'side')
        ? 'inset'
        : (doc.layout.bandShape ?? 'full'),
    'data-qb-image-phone': doc.layout.imagePhone ?? 'show',
    'data-qb-band-height': doc.layout.bandHeight ?? 'roomy',
    // A glow rising from the band's foot, which a short title band leaves off.
    'data-qb-band-glow':
      doc.layout.bandGlow === 'bottom' && (band === 'brand' || band === 'support')
        ? 'foot'
        : 'none',
    // Over a page of more than one colour in a mode it shows, the band can fade out itself.
    'data-qb-band-over': shownModes(doc).every((mode) => onePageColour(doc, mode))
      ? 'page'
      : 'fill',
    'data-qb-header-band': headerOnBand(doc) ? 'on' : 'off',
    'data-qb-header-span': headerSpans(doc) ? 'on' : headerOverPhoto(doc) ? 'photo' : 'off',
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
    // The band's button in the second colour, rather than as the other buttons are.
    'data-qb-band-action':
      doc.shape.action === 'support' && doc.brand.light.support
        ? 'support'
        : doc.shape.action === 'accent'
          ? 'accent'
          : 'buttons',
    'data-qb-filters': filters,
    'data-qb-menu-align': header === 'inline' ? (doc.layout.menuAlign ?? 'start') : 'start',
    'data-qb-hover': doc.shape.hover ?? 'none',
    // What post cards leave out, each on or off.
    'data-qb-card-excerpt': doc.layout.postCardHides?.includes('excerpt') ? 'off' : 'on',
    'data-qb-card-tags': doc.layout.postCardHides?.includes('tags') ? 'off' : 'on',
    'data-qb-card-meta': doc.layout.postCardHides?.includes('meta') ? 'off' : 'on',
    ...pageChoiceAttributes(doc),
  }
}
