import type { ThemeVariables } from './types'

export interface MinimalThemeVariables {
  primary: string
  background: string
  foreground: string
  card: string
  muted: string
  mutedForeground: string
  border: string
  destructive: string
  success: string
  ring?: string
  fontSans?: string
  radius?: string
  /** Explicit secondary color - falls back to muted if not provided */
  secondary?: string
  /** Explicit accent color - falls back to muted if not provided */
  accent?: string
}

export interface MinimalThemeConfig {
  light?: MinimalThemeVariables
  dark?: MinimalThemeVariables
}

/** The variables an expansion cannot do without; the rest derive from these. */
type ThemeColorBase = Omit<
  MinimalThemeVariables,
  'ring' | 'secondary' | 'accent' | 'fontSans' | 'radius'
>

/**
 * Palette used for any variable a theme leaves out. These are the values
 * globals.css already ships as the un-branded defaults, so filling a gap emits
 * the value the page would otherwise have inherited. The `default` preset is
 * built from these same constants, which keeps the two from drifting apart.
 */
export const DEFAULT_LIGHT_BASE: ThemeColorBase = {
  primary: 'oklch(0.886 0.176 86)',
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.145 0 0)',
  card: 'oklch(1 0 0)',
  muted: 'oklch(0.97 0 0)',
  mutedForeground: 'oklch(0.556 0 0)',
  border: 'oklch(0.922 0 0)',
  destructive: 'oklch(0.577 0.245 27)',
  success: 'oklch(0.696 0.149 163)',
}

export const DEFAULT_DARK_BASE: ThemeColorBase = {
  primary: 'oklch(0.886 0.176 86)',
  background: 'oklch(0.145 0 0)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.17 0 0)',
  muted: 'oklch(0.269 0 0)',
  mutedForeground: 'oklch(0.708 0 0)',
  border: 'oklch(0.269 0 0)',
  destructive: 'oklch(0.396 0.141 25)',
  success: 'oklch(0.696 0.149 163)',
}

/** Every variable a theme may carry. Anything else on the object is derived. */
const MINIMAL_KEYS = [
  'primary',
  'background',
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'border',
  'destructive',
  'success',
  'ring',
  'secondary',
  'accent',
  'fontSans',
  'radius',
] as const

/**
 * Fill the gaps in a theme with the base palette for that mode.
 *
 * Branding is stored as a loose JSON blob written one variable at a time, so a
 * workspace that picks a brand colour and stops saves `{ primary }` and nothing
 * else — an ordinary shape the expander has to survive. Only a usable value
 * counts as a choice: an absent key, a null (JSON's way of carrying "cleared")
 * and an empty string all fall through to the base, while anything the
 * workspace did set is passed on untouched.
 */
function resolveMinimal(
  minimal: Partial<MinimalThemeVariables>,
  mode: 'light' | 'dark'
): MinimalThemeVariables {
  const resolved: MinimalThemeVariables = {
    ...(mode === 'light' ? DEFAULT_LIGHT_BASE : DEFAULT_DARK_BASE),
  }
  for (const key of MINIMAL_KEYS) {
    const value = minimal[key]
    if (typeof value === 'string' && value.trim() !== '') resolved[key] = value
  }
  return resolved
}

const LIGHT_SHADOWS = {
  shadow2xs: '0 1px oklch(0 0 0 / 0.05)',
  shadowXs: '0 1px 2px 0 oklch(0 0 0 / 0.05)',
  shadowSm: '0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1)',
  shadow: '0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1)',
  shadowMd: '0 4px 6px -1px oklch(0 0 0 / 0.1), 0 2px 4px -2px oklch(0 0 0 / 0.1)',
  shadowLg: '0 10px 15px -3px oklch(0 0 0 / 0.1), 0 4px 6px -4px oklch(0 0 0 / 0.1)',
  shadowXl: '0 20px 25px -5px oklch(0 0 0 / 0.1), 0 8px 10px -6px oklch(0 0 0 / 0.1)',
  shadow2xl: '0 25px 50px -12px oklch(0 0 0 / 0.25)',
}

const DARK_SHADOWS = {
  shadow2xs: '0 1px oklch(0 0 0 / 0.15)',
  shadowXs: '0 1px 2px 0 oklch(0 0 0 / 0.15)',
  shadowSm: '0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25)',
  shadow: '0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25)',
  shadowMd: '0 4px 6px -1px oklch(0 0 0 / 0.25), 0 2px 4px -2px oklch(0 0 0 / 0.25)',
  shadowLg: '0 10px 15px -3px oklch(0 0 0 / 0.25), 0 4px 6px -4px oklch(0 0 0 / 0.25)',
  shadowXl: '0 20px 25px -5px oklch(0 0 0 / 0.25), 0 8px 10px -6px oklch(0 0 0 / 0.25)',
  shadow2xl: '0 25px 50px -12px oklch(0 0 0 / 0.5)',
}

export function parseOklch(oklch: string): { l: number; c: number; h: number } | null {
  const match = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) return null
  return { l: parseFloat(match[1]), c: parseFloat(match[2]), h: parseFloat(match[3]) }
}

export function formatOklch(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(0)})`
}

export function adjustHue(oklch: string, degrees: number): string {
  const parsed = parseOklch(oklch)
  if (!parsed) return oklch
  return formatOklch(parsed.l, parsed.c, (parsed.h + degrees + 360) % 360)
}

export function computeContrastForeground(bgOklch: string): string {
  const parsed = parseOklch(bgOklch)
  if (!parsed) return 'oklch(0.985 0 0)'
  return parsed.l > 0.6 ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)'
}

export function generateChartColors(primary: string): [string, string, string, string, string] {
  const parsed = parseOklch(primary)
  if (!parsed) {
    return [
      'oklch(0.886 0.176 86)',
      'oklch(0.696 0.149 163)',
      'oklch(0.769 0.165 70)',
      'oklch(0.645 0.215 16)',
      'oklch(0.606 0.219 293)',
    ]
  }

  const { l, c, h } = parsed
  const goldenAngle = 137.5

  return [
    primary,
    formatOklch(l, c, (h + goldenAngle) % 360),
    formatOklch(l, c, (h + goldenAngle * 2) % 360),
    formatOklch(l, c, (h + goldenAngle * 3) % 360),
    formatOklch(l, c, (h + goldenAngle * 4) % 360),
  ]
}

/**
 * Expand a theme into the full variable set. The input is whatever the
 * workspace saved, complete or not: gaps resolve to the base palette first, so
 * every variable read below is a real value.
 */
export function expandTheme(
  partial: Partial<MinimalThemeVariables>,
  options: { mode: 'light' | 'dark' }
): ThemeVariables {
  const minimal = resolveMinimal(partial, options.mode)
  const shadows = options.mode === 'light' ? LIGHT_SHADOWS : DARK_SHADOWS
  const primaryForeground = computeContrastForeground(minimal.primary)
  const destructiveForeground = computeContrastForeground(minimal.destructive)
  const charts = generateChartColors(minimal.primary)

  return {
    primary: minimal.primary,
    background: minimal.background,
    foreground: minimal.foreground,
    card: minimal.card,
    muted: minimal.muted,
    mutedForeground: minimal.mutedForeground,
    border: minimal.border,
    destructive: minimal.destructive,
    success: minimal.success,
    primaryForeground,
    ring: minimal.ring ?? minimal.primary,
    cardForeground: minimal.foreground,
    popover: minimal.card,
    popoverForeground: minimal.foreground,
    secondary: minimal.secondary ?? minimal.muted,
    secondaryForeground: minimal.foreground,
    accent: minimal.accent ?? minimal.muted,
    accentForeground: minimal.foreground,
    input: minimal.border,
    destructiveForeground,
    chart1: charts[0],
    chart2: charts[1],
    chart3: charts[2],
    chart4: charts[3],
    chart5: charts[4],
    fontSans: minimal.fontSans,
    radius: minimal.radius,
    ...shadows,
  }
}

/**
 * Project a full variable set back down to the ones worth storing. The input is
 * an all-optional theme, so the result is too — a variable that was never set
 * stays unset rather than being asserted into existence, and expandTheme
 * resolves it from the base palette when the theme is next rendered.
 */
export function extractMinimal(vars: ThemeVariables): Partial<MinimalThemeVariables> {
  return {
    primary: vars.primary,
    background: vars.background,
    foreground: vars.foreground,
    card: vars.card,
    muted: vars.muted,
    mutedForeground: vars.mutedForeground,
    border: vars.border,
    destructive: vars.destructive,
    success: vars.success,
    ring: vars.ring !== vars.primary ? vars.ring : undefined,
    fontSans: vars.fontSans,
    radius: vars.radius,
    // Only include secondary/accent if they differ from muted
    secondary: vars.secondary !== vars.muted ? vars.secondary : undefined,
    accent: vars.accent !== vars.muted ? vars.accent : undefined,
  }
}
