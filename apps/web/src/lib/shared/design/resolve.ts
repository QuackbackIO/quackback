/**
 * Turns a portal design into the CSS variables the portal reads.
 *
 * Tokens start from today's theme expander, so a design converted from
 * today's branding renders the same. The contrast solver then lifts every
 * pair the portal paints to its target and records each change, which is the
 * full list of ways a converted portal can look different.
 */
import { DEFAULT_DARK_BASE, expandTheme, parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import {
  PRIMARY_BUTTONS,
  tuneColourCss,
  tuneCss,
  tunedColours,
  tuneHexes,
  type TunedColour,
  type TuneSurface,
} from './tune'
import { variableMap } from '@/lib/shared/theme/generator'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { contrastRatio, solveContrast } from './contrast'
import {
  bandError,
  baseTokens,
  headlineBehind,
  modeTokens,
  PORTAL_ALIASES,
  type TokenMap,
} from './components'
import { fontStack, WORD_GAP_FLOOR } from './fonts'
import {
  backgroundsBehind,
  drawBackgrounds,
  hasPageBackground,
  pageBackgroundCss,
  type ModeBackgrounds,
} from './page-background'
import { wordsColourCss } from './words-colour'
import { DESIGN_LAYERS, styleCss, type StyleCheck } from './style-css'
import type { PortalDesign } from './schema'
import { drawnSurfaces, surfacesDrawing, type Drawn, type Surface } from './surfaces'

type Mode = 'light' | 'dark'

export interface DesignAdjustment {
  mode: Mode
  token: keyof ThemeVariables
  from: string
  to: string
  reason: string
}

export interface ResolvedDesign {
  mode: PortalDesign['mode']
  /** Null when the design never shows light. */
  light: ThemeVariables | null
  /** Null when the design never shows dark. */
  dark: ThemeVariables | null
  adjustments: DesignAdjustment[]
  /** Pairs the solver cannot fix without changing a colour the brand chose. */
  errors: string[]
  /** Component tokens: sizes for both modes, and each mode's colours. */
  tokens: { base: TokenMap; light: TokenMap; dark: TokenMap }
  /** The rules the design's exact values need, after the rest. */
  tuneCss: string
  /** The exact text colours, as set and as used so they read. */
  tuned: TunedColour[]
  /** Each mode's page backgrounds as drawn, the site's and each page's own; null for a mode not shown. */
  backgrounds: { light: ModeBackgrounds | null; dark: ModeBackgrounds | null }
  /** The page backgrounds' CSS; empty when every page shows its page colour. */
  backgroundCss: string
  /** The element styles' rules, after the exact values (style-css.ts). */
  styleCss: string
  /** Each element style's text, as set and as drawn so it reads. */
  styled: StyleCheck[]
}

const CORNER_RADIUS: Record<PortalDesign['shape']['corners'], string> = {
  sharp: '0rem',
  subtle: '0.25rem',
  rounded: '0.5rem',
  pill: '1rem',
}

const NEAR_BLACK = 'oklch(0.145 0 0)'
const NEAR_WHITE = 'oklch(0.985 0 0)'

/** Below this OKLCH chroma a brand colour is black, grey or white: a monochrome brand's. */
const NEUTRAL_CHROMA = 0.03
/** A brand colour against the page: buttons, links and the menu's mark need 3:1 to be seen. */
const VISIBLE = 3

/**
 * Dark mode's brand colour where the design sets none, worked out from
 * light's: a colour lightened in its own hue only as far as it must be to
 * read on the dark page; a black or grey one, the dark page's text colour,
 * as a monochrome brand reverses.
 */
export function darkAccent(doc: PortalDesign): string {
  const own = doc.brand.dark?.accent
  if (own) return own
  const accent = doc.brand.light.accent
  const page = doc.brand.dark?.background ?? DEFAULT_DARK_BASE.background
  if (contrastRatio(accent, page) >= VISIBLE) return accent
  const parsed = parseOklch(accent.startsWith('#') ? hexToOklch(accent) : accent)
  if (!parsed) return accent
  if (parsed.c < NEUTRAL_CHROMA) return doc.brand.dark?.ink ?? DEFAULT_DARK_BASE.foreground
  return solveContrast(accent, [page], VISIBLE) ?? accent
}

/** Today's tokens for one mode of a design, before any solving. */
function expandMode(doc: PortalDesign, mode: Mode): ThemeVariables {
  const { light } = doc.brand
  const palette = mode === 'light' ? light : { ...doc.brand.dark, accent: darkAccent(doc) }
  const minimal = {
    primary: palette.accent,
    background: palette.background,
    foreground: palette.ink,
    card: palette.surface,
    muted: palette.raised,
    mutedForeground: palette.muted,
    border: palette.border,
    fontSans: fontStack(doc.brand.fonts.body),
    radius: CORNER_RADIUS[doc.shape.corners],
  }
  const defined = Object.fromEntries(
    Object.entries(minimal).filter(([, value]) => value !== undefined)
  )
  return expandTheme(defined, { mode })
}

function solveMode(
  vars: ThemeVariables,
  mode: Mode,
  adjustments: DesignAdjustment[],
  errors: string[],
  /** What page text sits on beyond the page colour: a page background's colours, once the brand colour is settled. */
  pageBehind: (vars: Required<ThemeVariables>) => string[] = () => [],
  /** The other surfaces the site's colours are drawn on (surfaces.ts), once the brand colour is settled. */
  drawn: (vars: Required<ThemeVariables>) => Surface[] = () => []
) {
  const t = vars as Required<ThemeVariables>
  const set = (token: keyof ThemeVariables, to: string, reason: string) => {
    const from = String(vars[token])
    if (from === to) return
    adjustments.push({ mode, token, from, to, reason })
    vars[token] = to
  }

  // Ink is the brand's own choice, so an unreadable pair is refused, not fixed.
  for (const [bg, name] of [
    [t.background, 'background'],
    [t.card, 'cards'],
    [t.muted, 'raised surfaces'],
  ] as const) {
    if (contrastRatio(t.foreground, bg) < 4.5) errors.push(`${mode}: ink on ${name} is below 4.5:1`)
  }

  // Button text: the legacy pick first, then the other, then move the fill.
  const texts =
    contrastRatio(NEAR_BLACK, t.primary) >= contrastRatio(NEAR_WHITE, t.primary)
      ? [NEAR_BLACK, NEAR_WHITE]
      : [NEAR_WHITE, NEAR_BLACK]
  const current = t.primaryForeground
  const passing = [current, ...texts].find((text) => contrastRatio(text, t.primary) >= 4.5)
  if (passing) {
    set('primaryForeground', passing, 'button text on the accent')
  } else {
    const fill = solveContrast(t.primary, [current], 4.5)
    if (fill) set('primary', fill, 'button text on the accent')
    else errors.push(`${mode}: no text reaches 4.5:1 on the accent`)
  }

  // Page text, secondary text and links read on every colour a page background puts behind them.
  const behind = pageBehind(t)
  if (behind.some((bg) => contrastRatio(t.foreground, bg) < 4.5))
    errors.push(`${mode}: ink on the page background is below 4.5:1`)
  const surfaces = drawn(t)
  for (const surface of surfaces)
    if (surface.draws.includes('Text') && contrastRatio(t.foreground, surface.colour) < 4.5)
      errors.push(`${mode}: ink on ${surface.on} is below 4.5:1`)
  const on = (what: Drawn) => surfacesDrawing(surfaces, what)

  const solve = (
    token: keyof ThemeVariables,
    backgrounds: string[],
    target: number,
    reason: string
  ) => {
    const solved = solveContrast(String(vars[token]), backgrounds, target)
    if (solved) set(token, solved, reason)
    else errors.push(`${mode}: ${reason} cannot reach ${target}:1`)
  }
  solve(
    'mutedForeground',
    [t.background, t.card, t.muted, ...behind, ...on('Secondary text')],
    4.5,
    'secondary text'
  )
  solve(
    'accentInk',
    [t.background, t.card, t.accent, ...behind, ...on('Links')],
    4.5,
    'links and accent text'
  )
  solve('destructive', [t.background], 4.5, 'error text')
  solve('input', [t.background], 3, 'field edges')
  // The ring reads on the page and cards, and on brand-colour buttons wherever one colour can.
  const rings = [t.background, t.card, ...on('The focus ring')]
  const ring = solveContrast(String(vars.ring), [...rings, t.primary], 3)
  if (ring) set('ring', ring, 'the focus ring on buttons')
  solve('ring', rings, 3, 'the focus ring')
}

export function resolveDesign(doc: PortalDesign): ResolvedDesign {
  const adjustments: DesignAdjustment[] = []
  const errors: string[] = []
  const drawn: ResolvedDesign['backgrounds'] = { light: null, dark: null }
  const paints = hasPageBackground(doc)
  const resolveMode = (mode: Mode) => {
    const vars = expandMode(doc, mode)
    solveMode(
      vars,
      mode,
      adjustments,
      errors,
      (t) => {
        if (!paints) return []
        drawn[mode] = drawBackgrounds(
          doc,
          { page: t.background, ink: t.foreground, accent: t.primary },
          mode
        )
        return backgroundsBehind(drawn[mode]!)
      },
      (t) => drawnSurfaces(doc, t, mode)
    )
    const band = bandError(doc, vars, mode)
    if (band) errors.push(band)
    return vars
  }
  const light = doc.mode === 'dark' ? null : resolveMode('light')
  const dark = doc.mode === 'light' ? null : resolveMode('dark')
  const tokens = {
    base: baseTokens(doc),
    light: light ? modeTokens(doc, light, 'light') : {},
    dark: dark ? modeTokens(doc, dark, 'dark') : {},
  }
  const surface = tuneSurface(doc, light, tokens.light, drawn.light)
  const style = styleCss(doc, light, dark)
  Object.assign(tokens.light, style.tokens.light)
  Object.assign(tokens.dark, style.tokens.dark)
  for (const check of style.checks)
    if (!check.used)
      errors.push(`${check.mode}: no text reaches ${check.target}:1 on ${check.where}`)
  return {
    mode: doc.mode,
    light,
    dark,
    adjustments,
    errors,
    tokens,
    tuneCss: [tuneCss(doc.tune), tuneColourCss(tuneHexes(doc), surface)].filter(Boolean).join(' '),
    tuned: tunedColours(tuneHexes(doc), surface),
    backgrounds: drawn,
    backgroundCss: pageBackgroundCss(doc, drawn),
    styleCss: style.css,
    styled: style.checks,
  }
}

/** What a tune's light-mode colours sit on: the page, and the band behind a headline. */
function tuneSurface(
  doc: PortalDesign,
  light: ThemeVariables | null,
  tokens: TokenMap,
  backgrounds: ModeBackgrounds | null
): TuneSurface | null {
  if (!light?.background) return null
  const panel = doc.layout.band !== 'none' && doc.layout.bandShape === 'panel'
  const band = panel ? [tokens['--qb-band-panel-bg']!] : headlineBehind(doc, light, 'light')
  // An image under the words has no one colour to read on.
  const mixed = !!doc.brand.bandImage && (doc.layout.imagePlace ?? 'side') !== 'side'
  const page = backgrounds ? backgroundsBehind(backgrounds) : []
  const subtitle = tokens['--qb-band-subtitle']
  return {
    background: light.background,
    band,
    mixed,
    ...(page.length ? { page } : {}),
    ...(subtitle
      ? { subtitle: { ink: subtitle, target: tokens['--qb-band-subtitle-size'] ? 3 : 4.5 } }
      : {}),
  }
}

/**
 * The semantic tokens portal components can read, by the theme variable each
 * one holds. Inside the scope the component library's names point at these.
 */
const SEMANTIC_TOKENS: Partial<Record<keyof ThemeVariables, string>> = {
  primary: '--qb-accent',
  primaryForeground: '--qb-on-accent',
  accentInk: '--qb-accent-text',
  accent: '--qb-accent-subtle',
  background: '--qb-bg',
  card: '--qb-surface',
  muted: '--qb-raised',
  foreground: '--qb-ink',
  mutedForeground: '--qb-muted',
  border: '--qb-border',
  input: '--qb-border-strong',
  ring: '--qb-focus',
  destructive: '--qb-danger',
  destructiveForeground: '--qb-on-danger',
  success: '--qb-success',
  chart1: '--qb-chart-1',
  chart2: '--qb-chart-2',
  chart3: '--qb-chart-3',
  chart4: '--qb-chart-4',
  chart5: '--qb-chart-5',
}

/** One mode's values: semantic tokens by their own name, the rest by the library's. */
function declarations(vars: ThemeVariables): string {
  return Object.entries(vars)
    .filter(([key, value]) => variableMap[key] && value)
    .map(([key, value]) => {
      const name = SEMANTIC_TOKENS[key as keyof ThemeVariables] ?? variableMap[key]
      return `${name}: ${value};`
    })
    .join(' ')
}

/**
 * The names components already read, pointed at the tokens: the library's
 * names and the portal's own. Written once, since each mode only changes the
 * tokens.
 */
function aliases(vars: ThemeVariables): string {
  const library = Object.entries(SEMANTIC_TOKENS)
    .filter(([key]) => vars[key as keyof ThemeVariables])
    .map(([key, token]) => `${variableMap[key]}: var(${token});`)
  const portal = Object.entries(PORTAL_ALIASES).map(([name, token]) => `${name}: var(${token});`)
  return [...library, ...portal].join(' ')
}

const tokenDeclarations = (tokens: TokenMap) =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')

/**
 * The design as CSS, scoped to `[data-portal-theme]` so only portal documents
 * match it. A design shown in both modes adds a block for `.dark`; one shown
 * in a single mode names `.dark` too, so no other design's dark block outranks
 * it, such as the live one under a draft's preview.
 */
export function renderDesignCss(resolved: ResolvedDesign): string {
  const primary = resolved.light ?? resolved.dark
  if (!primary) return ''
  const { tokens } = resolved
  const primaryTokens = resolved.light ? tokens.light : tokens.dark
  const scope =
    resolved.light && resolved.dark
      ? '[data-portal-theme]'
      : '[data-portal-theme], .dark[data-portal-theme]'
  const parts = [
    `${scope} { ${declarations(primary)} ${tokenDeclarations(tokens.base)} ${tokenDeclarations(primaryTokens)} ${aliases(primary)} }`,
  ]
  if (resolved.light && resolved.dark)
    parts.push(
      `.dark[data-portal-theme] { ${declarations(resolved.dark)} ${tokenDeclarations(tokens.dark)} }`
    )
  parts.push(
    `[data-portal-theme] body { --font-sans: ${primary.fontSans}; --radius: ${primary.radius}; }`
  )
  // A headline wider than the screen breaks a word rather than scroll the page.
  // Tracking never sets labels tighter than their face, and a word gap that the
  // face's space less its tracking would close below the floor opens to it (a
  // narrow space set tight reads as one word); other gaps are left as drawn.
  const gap = WORD_GAP_FLOOR
  // The heading family sits in the base layer, so a utility on a heading still
  // wins. The tracking and the heading weight sit in the design layer: after
  // utilities, as the app's own unlayered heading rule is elsewhere, and
  // before the workspace's CSS, which may set them for a part.
  parts.push(
    '@layer base { [data-portal-theme] :is(h1, h2, h3) { font-family: var(--qb-font-heading); } [data-portal-theme] :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; } }'
  )
  parts.push(
    `@layer design { [data-portal-theme] { letter-spacing: -0.01em; } [data-portal-theme], [data-portal-theme] :is(button, input, textarea, select) { word-spacing: max(0em, calc(${gap} - var(--qb-body-space))); } [data-portal-theme] :is(h1, h2, h3) { font-weight: var(--qb-heading-weight); letter-spacing: -0.02em; word-spacing: max(0em, calc(${gap} + 0.02em - var(--qb-heading-space))); } [data-portal-theme] [data-qb-part=headline] { font-family: var(--qb-font-display); font-weight: var(--qb-headline-weight); letter-spacing: var(--qb-headline-tracking); word-spacing: max(0em, calc(${gap} - var(--qb-headline-tracking) - var(--qb-display-space))); text-transform: var(--qb-headline-case); overflow-wrap: break-word; } [data-portal-theme] :is([data-qb-part=nav-item], [data-qb-label]) { text-transform: var(--qb-label-case); letter-spacing: max(0em, var(--qb-label-tracking)); } }`
  )
  // A prompt longer than its box (a composer on a phone) ends in an ellipsis, not a sliced letter.
  parts.push('@layer design { [data-portal-theme] input { text-overflow: ellipsis; } }')
  // Every card in the portal takes the design's card style: raised cards float
  // without an edge, list cards are rows divided by rules, filled cards are
  // their own colour with larger corners. Bordered cards are as drawn.
  parts.push(
    '@layer design { [data-qb-cards=raised][data-portal-theme] [data-qb-surface=card] { border-color: transparent; } [data-qb-cards=raised][data-portal-theme] [data-qb-surface=card]:not(:focus-visible) { box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); } [data-qb-cards=list][data-portal-theme] [data-qb-surface=card] { border-radius: 0; border-inline-width: 0; border-top-width: 0; background: transparent; } [data-qb-cards=filled][data-portal-theme] [data-qb-surface=card] { border-color: transparent; border-radius: calc(var(--qb-radius-panel, 0.75rem) * 1.6); } [data-qb-cards=list][data-portal-theme] [data-qb-surface=card]:not(:focus-visible), [data-qb-cards=filled][data-portal-theme] [data-qb-surface=card]:not(:focus-visible) { box-shadow: none; } }'
  )
  // Primary buttons in the text colour, when the design asks.
  parts.push(
    `@layer design { [data-qb-fill=ink][data-portal-theme] :is(${PRIMARY_BUTTONS}) { background-color: var(--qb-fill-bg); color: var(--qb-fill-ink); } [data-qb-fill=ink][data-portal-theme] :is(${PRIMARY_BUTTONS}):hover { background-color: color-mix(in oklch, var(--qb-fill-bg) 85%, var(--qb-fill-ink)); } [data-qb-fill=ink]:is([data-qb-band-action=support], [data-qb-band-action=accent])[data-portal-theme] [data-qb-action] { background-color: var(--qb-action-bg); color: var(--qb-action-ink); } }`
  )
  // The focus ring in the band and on the header reads on their colours; cards in the band keep the page's.
  parts.push(
    '@layer design { [data-portal-theme] [data-qb-part=band] { --ring: var(--qb-band-focus); } [data-portal-theme] [data-qb-part=band] :is([data-qb-surface=card], [data-qb-part=composer]) { --ring: var(--qb-focus); } [data-portal-theme] .portal-header { --ring: var(--qb-header-focus); } }'
  )
  // A vote box's edge is its only boundary, so it reads at 3:1.
  parts.push(
    '@layer design { [data-portal-theme] [data-qb-part=vote-button]:not([data-state=voted]) { border-color: var(--qb-vote-edge); } }'
  )
  // Vote boxes tinted with the second colour, when the design asks.
  parts.push(
    '@layer design { [data-qb-tint=support][data-portal-theme] [data-qb-part=vote-button]:not([data-state=voted]) { background: var(--qb-support-tint); border-color: var(--qb-support-edge); } }'
  )
  // Status markers: in the ink, or as tags tinted with each status's colour.
  parts.push(
    '@layer design { [data-qb-status=ink][data-portal-theme] [data-qb-status-dot] { background: var(--qb-ink); } [data-qb-status=pill][data-portal-theme] [data-qb-part=status-badge] { padding: 0.125rem 0.5rem; border-radius: var(--qb-radius-control); background: color-mix(in oklch, var(--qb-status, var(--qb-muted)) 18%, var(--qb-surface)); } [data-qb-status=pill][data-portal-theme] [data-qb-part=status-badge] > [data-qb-status-dot] { display: none; } }'
  )
  // Words and headline accents in a colour role, read where they sit; nothing when there are none.
  const words = wordsColourCss({ ...tokens.light, ...tokens.dark })
  if (words) parts.push(words)
  parts.push(MOTION_CSS)
  parts.push(BRAND_TONE_CSS)
  if (resolved.backgroundCss) parts.push(resolved.backgroundCss)
  if (resolved.tuneCss) parts.push(resolved.tuneCss)
  // The element looks sit over the rest of the design in their own sub-layers, in cascade order.
  const rest = parts.join(' ').replaceAll('@layer design {', '@layer design.base {')
  // Stated just before the first design rule, never before another layer: where this style tag
  // comes before the app's stylesheet, the order layers first appear in is their order, and
  // naming `design` before `base` would put the whole design layer under the base layer.
  const first = rest.indexOf('@layer design.base {')
  const order = `@layer ${DESIGN_LAYERS.join(', ')};`
  return [rest.slice(0, first).trimEnd(), order, rest.slice(first), resolved.styleCss]
    .filter(Boolean)
    .join(' ')
}

/** The library's name and the design's own for each colour a block in the brand colour redraws. */
const TONE_INK = [
  '--foreground',
  '--qb-ink',
  '--card-foreground',
  '--muted-foreground',
  '--qb-muted',
  '--primary',
  '--qb-accent',
  '--qb-accent-text',
  '--qb-vote-active',
  '--post-card-voted-color',
  '--ring',
  '--qb-focus',
  '--qb-fill-bg',
]
/**
 * Motion under the pointer and the inline header's centred menu. Lift raises
 * primary buttons and post cards; arrow adds one to each block's way on and
 * nudges it. Nothing moves for a visitor who asks for less motion.
 */
const MOTION_CSS = `@layer design { [data-qb-menu-align=centre][data-portal-theme] .portal-header [data-qb-nav-row] > .portal-nav { justify-content: safe center; } [data-qb-hover=arrow][data-portal-theme] [data-qb-link]::after { content: '\\2192'; text-align: end; inset-inline-end: -1.25em; padding-block-start: inherit; } @media (prefers-reduced-motion: no-preference) { [data-qb-hover=arrow][data-portal-theme] [data-qb-link]::after { transition: transform 150ms ease; } [data-qb-hover=arrow][data-portal-theme] [data-qb-link]:hover::after { transform: translateX(3px); } } }`

const TONE_FILL = ['--primary-foreground', '--qb-on-accent', '--qb-fill-ink']
const TONE_RAISED = [
  '--card',
  '--qb-surface',
  '--muted',
  '--qb-raised',
  '--accent',
  '--qb-accent-subtle',
  '--qb-support-tint',
]
const TONE_EDGE = [
  '--border',
  '--qb-border',
  '--input',
  '--qb-border-strong',
  '--qb-support-edge',
  '--qb-vote-edge',
]
const PROSE = [
  'body',
  'headings',
  'lead',
  'links',
  'bold',
  'counters',
  'bullets',
  'quotes',
  'captions',
  'code',
]

/**
 * A block in the brand colour draws all of its parts in the colour that reads
 * on it: text, links, buttons, vote boxes and rich text; a vote shows by its
 * edge and arrow rather than a deeper fill. The block keeps the
 * two colours as `--qb-tone-fill` and `--qb-tone-ink`; the names every part
 * reads already hold the site's values, so the block's children set them again.
 */
const BRAND_TONE_CSS = `@layer design { [data-portal-theme] [data-qb-tone=brand] > * { ${[
  ...TONE_INK.map((name) => `${name}: var(--qb-tone-ink);`),
  ...TONE_FILL.map((name) => `${name}: var(--qb-tone-fill);`),
  ...TONE_RAISED.map(
    (name) => `${name}: color-mix(in oklch, var(--qb-tone-ink) 5%, var(--qb-tone-fill));`
  ),
  ...TONE_EDGE.map(
    (name) => `${name}: color-mix(in oklch, var(--qb-tone-ink) 35%, var(--qb-tone-fill));`
  ),
].join(' ')} } [data-portal-theme] [data-qb-tone=brand] .prose { ${PROSE.flatMap((name) => [
  `--tw-prose-${name}: var(--qb-tone-ink);`,
  `--tw-prose-invert-${name}: var(--qb-tone-ink);`,
]).join(
  ' '
)} } [data-portal-theme] [data-qb-tone=brand] [data-qb-part=vote-button][data-state=voted] { background: color-mix(in oklch, var(--qb-tone-ink) 5%, var(--qb-tone-fill)); } }`
