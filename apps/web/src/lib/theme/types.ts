export interface ThemeVariables {
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
  success?: string
  chart1?: string
  chart2?: string
  chart3?: string
  chart4?: string
  chart5?: string
  fontSans?: string
  radius?: string
  shadow2xs?: string
  shadowXs?: string
  shadowSm?: string
  shadow?: string
  shadowMd?: string
  shadowLg?: string
  shadowXl?: string
  shadow2xl?: string
}

export interface ThemeConfig {
  light?: ThemeVariables
  dark?: ThemeVariables
}

export interface ThemePreset {
  name: string
  description: string
  color: string
  light: ThemeVariables
  dark: ThemeVariables
}

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
