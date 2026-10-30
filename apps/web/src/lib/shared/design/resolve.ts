/**
 * Turns a portal design into the CSS variables the portal reads.
 *
 * Tokens start from today's theme expander, so a design converted from
 * today's branding renders the same. The contrast solver then lifts every
 * pair the portal paints to its target and records each change, which is the
 * full list of ways a converted portal can look different.
 */
import { expandTheme, formatOklch, parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { variableMap } from '@/lib/shared/theme/generator'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { contrastRatio } from './contrast'
import { baseTokens, modeTokens, PORTAL_ALIASES, type TokenMap } from './components'
import { fontStack } from './fonts'
import type { PortalDesign } from './schema'

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
}

const CORNER_RADIUS: Record<PortalDesign['shape']['corners'], string> = {
  sharp: '0rem',
  subtle: '0.25rem',
  rounded: '0.5rem',
  pill: '1rem',
}

const NEAR_BLACK = 'oklch(0.145 0 0)'
const NEAR_WHITE = 'oklch(0.985 0 0)'
const STEP = 0.005

function toOklch(color: string): { l: number; c: number; h: number } {
  const parsed = parseOklch(color.startsWith('#') ? hexToOklch(color) : color)
  if (!parsed) throw new Error(`Cannot adjust "${color}"`)
  return parsed
}

const lowest = (color: string, backgrounds: string[]) =>
  Math.min(...backgrounds.map((bg) => contrastRatio(color, bg)))

/**
 * The colour nearest to `color` in lightness that reaches `target` against
 * every background, keeping its chroma and hue. Null when none does.
 */
export function solveContrast(color: string, backgrounds: string[], target: number): string | null {
  if (lowest(color, backgrounds) >= target) return color
  const { l, c, h } = toOklch(color)
  // Darker against light backgrounds, lighter against dark ones.
  const direction =
    contrastRatio(backgrounds[0], '#000000') > contrastRatio(backgrounds[0], '#ffffff') ? -1 : 1
  for (let next = l + direction * STEP; next >= 0 && next <= 1; next += direction * STEP) {
    const candidate = formatOklch(next, c, h)
    if (lowest(candidate, backgrounds) >= target) return candidate
  }
  return null
}

/** Today's tokens for one mode of a design, before any solving. */
function expandMode(doc: PortalDesign, mode: Mode): ThemeVariables {
  const { light } = doc.brand
  const palette = mode === 'light' ? light : { accent: light.accent, ...doc.brand.dark }
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
  errors: string[]
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
  solve('mutedForeground', [t.background, t.card, t.muted], 4.5, 'secondary text')
  solve('accentInk', [t.background, t.card, t.accent], 4.5, 'links and accent text')
  solve('destructive', [t.background], 4.5, 'error text')
  solve('input', [t.background], 3, 'field edges')
  solve('ring', [t.background, t.card], 3, 'the focus ring')
}

export function resolveDesign(doc: PortalDesign): ResolvedDesign {
  const adjustments: DesignAdjustment[] = []
  const errors: string[] = []
  const resolveMode = (mode: Mode) => {
    const vars = expandMode(doc, mode)
    solveMode(vars, mode, adjustments, errors)
    return vars
  }
  const light = doc.mode === 'dark' ? null : resolveMode('light')
  const dark = doc.mode === 'light' ? null : resolveMode('dark')
  return {
    mode: doc.mode,
    light,
    dark,
    adjustments,
    errors,
    tokens: {
      base: baseTokens(doc),
      light: light ? modeTokens(doc, light, 'light') : {},
      dark: dark ? modeTokens(doc, dark, 'dark') : {},
    },
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
 * match it. A design shown in both modes adds a block for `.dark`.
 */
export function renderDesignCss(resolved: ResolvedDesign): string {
  const primary = resolved.light ?? resolved.dark
  if (!primary) return ''
  const { tokens } = resolved
  const primaryTokens = resolved.light ? tokens.light : tokens.dark
  const parts = [
    `[data-portal-theme] { ${declarations(primary)} ${tokenDeclarations(tokens.base)} ${tokenDeclarations(primaryTokens)} ${aliases(primary)} }`,
  ]
  if (resolved.light && resolved.dark)
    parts.push(
      `.dark[data-portal-theme] { ${declarations(resolved.dark)} ${tokenDeclarations(tokens.dark)} }`
    )
  parts.push(
    `[data-portal-theme] body { --font-sans: ${primary.fontSans}; --radius: ${primary.radius}; }`
  )
  parts.push(`[data-portal-theme] body { font-family: ${primary.fontSans} !important; }`)
  return parts.join(' ')
}
