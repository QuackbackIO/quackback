import type { CustomFont } from './font-uploads'
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
  accentInk?: string
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
  /** The font titles and headings are set in; unset, the text font. */
  fontHeading?: string
  radius?: string
  shadow2xs?: string
  shadowXs?: string
  shadowSm?: string
  shadow?: string
  shadowMd?: string
  shadowLg?: string
  shadowXl?: string
  shadow2xl?: string
  /** The header bar and what sits on it; set only when the theme gives it a colour. */
  header?: string
  headerForeground?: string
  headerBorder?: string
  navActiveBackground?: string
  navActiveForeground?: string
  navInactiveColor?: string
  headerPrimary?: string
  headerPrimaryForeground?: string
}

export type ThemeMode = 'light' | 'dark' | 'user'

/** Button corners: 'pill' (default) or the theme's corner radius. */
export type ButtonShape = 'pill' | 'corners'

/** How cards stand off the page: a border (default), a shadow, or a fill alone. */
export const CARD_STYLES = ['border', 'shadow', 'flat'] as const
export type CardStyle = (typeof CARD_STYLES)[number]

/** A headings font kept to page-level headings. */
export type HeadingScope = 'page'

export interface ThemeConfig {
  /** Theme mode: 'light' (force light), 'dark' (force dark), or 'user' (allow toggle) */
  themeMode?: ThemeMode
  /** Button corners: 'pill' (default) or the theme's corner radius */
  buttonShape?: ButtonShape
  /** An uploaded font family; written as @font-face plus the font stack, never as CSS text */
  customFont?: CustomFont
  /** Cards: 'border' (default), 'shadow' or 'flat'; written as the card variables */
  cardStyle?: CardStyle
  /**
   * An uploaded family for titles and headings, beside `customFont` and of
   * its shape, so it is checked, staged and published the same way
   */
  customHeadingFont?: CustomFont
  /**
   * Where the headings font is drawn: 'page' for page-level headings alone
   * (a display face a brand uses only large), with post and card titles in
   * the text font. Unset, every title and heading.
   */
  headingScope?: HeadingScope
  light?: ThemeVariables
  dark?: ThemeVariables
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
