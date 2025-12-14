/**
 * Theme customization types for organization portals
 */

/**
 * All customizable CSS variables (camelCase, mapped to kebab-case in CSS)
 */
export interface ThemeVariables {
  // Core colors
  background?: string
  foreground?: string
  card?: string
  cardForeground?: string
  popover?: string
  popoverForeground?: string
  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  muted?: string
  mutedForeground?: string
  accent?: string
  accentForeground?: string
  destructive?: string
  destructiveForeground?: string
  border?: string
  input?: string
  ring?: string

  // Success/info semantic colors
  success?: string
  successForeground?: string

  // Sidebar (optional - defaults to main if not set)
  sidebarBackground?: string
  sidebarForeground?: string
  sidebarPrimary?: string
  sidebarPrimaryForeground?: string
  sidebarAccent?: string
  sidebarAccentForeground?: string
  sidebarBorder?: string
  sidebarRing?: string

  // Charts (optional)
  chart1?: string
  chart2?: string
  chart3?: string
  chart4?: string
  chart5?: string

  // Typography
  fontSans?: string
  fontSerif?: string
  fontMono?: string

  // Border radius
  radius?: string

  // Shadows
  shadow2xs?: string
  shadowXs?: string
  shadowSm?: string
  shadow?: string
  shadowMd?: string
  shadowLg?: string
  shadowXl?: string
  shadow2xl?: string
}

/**
 * Theme configuration stored in organization.brandingConfig
 */
export interface ThemeConfig {
  /** Preset name for quick selection (indigo, emerald, rose, amber, violet, cyan) */
  preset?: string
  /** Custom light mode variable overrides */
  light?: ThemeVariables
  /** Custom dark mode variable overrides */
  dark?: ThemeVariables
}

/**
 * Preset definition with metadata and full variable sets
 */
export interface ThemePreset {
  /** Display name */
  name: string
  /** Short description of the theme aesthetic */
  description: string
  /** Preview hex color for UI */
  color: string
  /** Full light mode variables */
  light: ThemeVariables
  /** Full dark mode variables */
  dark: ThemeVariables
}

/**
 * Core variables exposed in advanced mode UI
 * (subset of ThemeVariables for simpler customization)
 */
export const CORE_THEME_VARIABLES = [
  'primary',
  'primaryForeground',
  'background',
  'foreground',
  'card',
  'cardForeground',
  'border',
  'muted',
  'mutedForeground',
  'accent',
  'ring',
] as const

export type CoreThemeVariable = (typeof CORE_THEME_VARIABLES)[number]
