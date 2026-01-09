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
}

export interface MinimalThemeConfig {
  light?: MinimalThemeVariables
  dark?: MinimalThemeVariables
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
      'oklch(0.623 0.188 260)',
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

export function expandTheme(
  minimal: MinimalThemeVariables,
  options: { mode: 'light' | 'dark' }
): ThemeVariables {
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
    secondary: minimal.muted,
    secondaryForeground: minimal.foreground,
    accent: minimal.muted,
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

export function extractMinimal(vars: ThemeVariables): MinimalThemeVariables {
  return {
    primary: vars.primary!,
    background: vars.background!,
    foreground: vars.foreground!,
    card: vars.card!,
    muted: vars.muted!,
    mutedForeground: vars.mutedForeground!,
    border: vars.border!,
    destructive: vars.destructive!,
    success: vars.success!,
    ring: vars.ring !== vars.primary ? vars.ring : undefined,
    fontSans: vars.fontSans,
    radius: vars.radius,
  }
}
