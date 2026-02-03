import type { ThemeConfig, ThemeVariables } from './types'
import { expandTheme, type MinimalThemeVariables } from './expand'

const variableMap: Record<string, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  success: '--success',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  fontSans: '--font-sans',
  radius: '--radius',
  shadow2xs: '--shadow-2xs',
  shadowXs: '--shadow-xs',
  shadowSm: '--shadow-sm',
  shadow: '--shadow',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  shadow2xl: '--shadow-2xl',
}

function variablesToCSS(vars: ThemeVariables): string {
  const declarations: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    const cssVar = variableMap[key]
    if (cssVar && value) {
      declarations.push(`${cssVar}: ${value};`)
    }
  }
  return declarations.join(' ')
}

export function generateThemeCSS(config: ThemeConfig): string {
  if (!config) return ''

  const themeMode = config.themeMode ?? 'user'
  const lightVars = config.light
    ? expandTheme(config.light as MinimalThemeVariables, { mode: 'light' })
    : {}
  const darkVars = config.dark
    ? expandTheme(config.dark as MinimalThemeVariables, { mode: 'dark' })
    : {}

  const parts: string[] = []

  // Only output light mode CSS if themeMode is not 'dark'
  // Use :root selector so custom CSS (e.g., from tweakcn) can override via cascade
  if (themeMode !== 'dark') {
    const lightCSS = variablesToCSS(lightVars)
    if (lightCSS) parts.push(`:root { ${lightCSS} }`)
  }

  // Only output dark mode CSS if themeMode is not 'light'
  if (themeMode !== 'light') {
    const darkCSS = variablesToCSS(darkVars)
    // When forcing dark mode, use :root instead of .dark so it applies without the class
    // Use .dark selector so custom CSS can override via cascade
    if (darkCSS) {
      if (themeMode === 'dark') {
        parts.push(`:root { ${darkCSS} }`)
      } else {
        parts.push(`.dark { ${darkCSS} }`)
      }
    }
  }

  const bodyDeclarations: string[] = []
  if (lightVars.fontSans) bodyDeclarations.push(`--font-sans: ${lightVars.fontSans}`)
  if (lightVars.radius) bodyDeclarations.push(`--radius: ${lightVars.radius}`)
  if (bodyDeclarations.length > 0) {
    parts.push(`body { ${bodyDeclarations.join('; ')}; }`)
  }

  if (lightVars.fontSans) {
    parts.push(`html body { font-family: ${lightVars.fontSans} !important; }`)
  }

  return parts.join(' ')
}

export function parseThemeConfig(json: string | null | undefined): ThemeConfig | null {
  if (!json) return null
  try {
    const config = JSON.parse(json)
    if (typeof config !== 'object') return null
    return config as ThemeConfig
  } catch {
    return null
  }
}

export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(config)
}

const GOOGLE_FONT_MAP: Record<string, string> = {
  '"Inter"': 'Inter',
  '"Roboto"': 'Roboto',
  '"Open Sans"': 'Open+Sans',
  '"Lato"': 'Lato',
  '"Montserrat"': 'Montserrat',
  '"Poppins"': 'Poppins',
  '"Nunito"': 'Nunito',
  '"DM Sans"': 'DM+Sans',
  '"Plus Jakarta Sans"': 'Plus+Jakarta+Sans',
  '"Geist"': 'Geist',
  '"Work Sans"': 'Work+Sans',
  '"Raleway"': 'Raleway',
  '"Source Sans 3"': 'Source+Sans+3',
  '"Outfit"': 'Outfit',
  '"Manrope"': 'Manrope',
  '"Space Grotesk"': 'Space+Grotesk',
  '"Playfair Display"': 'Playfair+Display',
  '"Merriweather"': 'Merriweather',
  '"Lora"': 'Lora',
  '"Crimson Text"': 'Crimson+Text',
  '"Fira Code"': 'Fira+Code',
  '"JetBrains Mono"': 'JetBrains+Mono',
}

function extractGoogleFont(fontFamily: string | undefined): string | null {
  if (!fontFamily) return null
  for (const [cssName, googleName] of Object.entries(GOOGLE_FONT_MAP)) {
    if (fontFamily.includes(cssName)) return googleName
  }
  return null
}

export function getGoogleFontsUrl(config: ThemeConfig): string | null {
  if (!config) return null
  const fontSans = config.light?.fontSans
  const googleFont = extractGoogleFont(fontSans)
  if (!googleFont) return null
  return `https://fonts.googleapis.com/css2?family=${googleFont}:wght@400;500;600;700&display=swap`
}
