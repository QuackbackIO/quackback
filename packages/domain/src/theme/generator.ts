import type { ThemeConfig, ThemeVariables } from './types'
import { themePresets } from './presets'

/**
 * Map camelCase variable names to CSS custom property names
 */
const variableMap: Record<keyof ThemeVariables, string> = {
  // Core colors
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

  // Success/info semantic colors
  success: '--success',
  successForeground: '--success-foreground',

  // Sidebar
  sidebarBackground: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',

  // Charts
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',

  // Typography
  fontSans: '--font-sans',
  fontSerif: '--font-serif',
  fontMono: '--font-mono',

  // Border radius
  radius: '--radius',

  // Shadows
  shadow2xs: '--shadow-2xs',
  shadowXs: '--shadow-xs',
  shadowSm: '--shadow-sm',
  shadow: '--shadow',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  shadow2xl: '--shadow-2xl',
}

/**
 * Convert a ThemeVariables object to CSS declarations string
 */
function variablesToCSS(vars: ThemeVariables): string {
  return Object.entries(vars)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const cssVar = variableMap[key as keyof ThemeVariables]
      if (!cssVar) return ''
      return `${cssVar}: ${value};`
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * Generate CSS string from a ThemeConfig
 *
 * The generated CSS overrides the default CSS variables defined in globals.css.
 * It handles:
 * - Preset-only configs (just apply preset values)
 * - Custom overrides (merge with preset or use directly)
 * - Light and dark mode separately
 *
 * Uses body selector for typography and radius to override Next.js font loader.
 *
 * @param config - Theme configuration object
 * @returns CSS string ready to be injected into a <style> tag
 */
export function generateThemeCSS(config: ThemeConfig): string {
  if (!config) return ''

  let lightVars: ThemeVariables = {}
  let darkVars: ThemeVariables = {}

  // Start with preset values if specified
  if (config.preset && themePresets[config.preset]) {
    const preset = themePresets[config.preset]
    lightVars = { ...preset.light }
    darkVars = { ...preset.dark }
  }

  // Merge custom overrides (custom values take precedence)
  if (config.light) {
    lightVars = { ...lightVars, ...config.light }
  }
  if (config.dark) {
    darkVars = { ...darkVars, ...config.dark }
  }

  // Generate CSS
  const lightCSS = variablesToCSS(lightVars)
  const darkCSS = variablesToCSS(darkVars)

  // Use high-specificity selectors to override globals.css and Next.js defaults
  // The theme CSS is injected in <body> via <style> tag, so we need extra specificity
  let css = ''

  // Override :root variables with html:root (0,0,1,1 specificity beats :root 0,0,1,0)
  if (lightCSS) {
    css += `html:root { ${lightCSS} }`
  }
  if (darkCSS) {
    css += ` html.dark { ${darkCSS} }`
  }

  // Override CSS variables on body too, since Next.js font loader sets --font-sans on body
  // via inter.variable class. We need to override on body so children inherit our values.
  // Also set --radius on body for consistent inheritance.
  const bodyVars: string[] = []
  if (lightVars.fontSans) bodyVars.push(`--font-sans: ${lightVars.fontSans}`)
  if (lightVars.radius) bodyVars.push(`--radius: ${lightVars.radius}`)
  if (bodyVars.length > 0) {
    css += ` body { ${bodyVars.join('; ')}; }`
  }

  // Override font-family directly on body with high specificity to beat Tailwind's font-sans class
  // html body has specificity 0,0,0,2 which beats .font-sans at 0,0,1,0... wait that's wrong
  // .font-sans (0,0,1,0) beats html body (0,0,0,2). We need !important or inline style.
  // Using !important as a last resort for portal theming.
  if (lightVars.fontSans) {
    css += ` html body { font-family: ${lightVars.fontSans} !important; }`
  }

  return css.trim()
}

/**
 * Parse a theme config from a JSON string safely
 *
 * @param json - JSON string from database
 * @returns Parsed ThemeConfig or null if invalid
 */
export function parseThemeConfig(json: string | null | undefined): ThemeConfig | null {
  if (!json) return null
  try {
    const config = JSON.parse(json)
    // Basic validation
    if (typeof config !== 'object') return null
    return config as ThemeConfig
  } catch {
    return null
  }
}

/**
 * Serialize a theme config to JSON string
 *
 * @param config - Theme configuration object
 * @returns JSON string
 */
export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(config)
}

/**
 * Map of font family CSS values to Google Fonts family names
 * Used to generate the Google Fonts URL
 */
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

/**
 * Extract the Google Font name from a font-family CSS string
 * Returns null if it's a system font or not recognized
 */
function extractGoogleFont(fontFamily: string | undefined): string | null {
  if (!fontFamily) return null

  // Check each known Google Font
  for (const [cssName, googleName] of Object.entries(GOOGLE_FONT_MAP)) {
    if (fontFamily.includes(cssName)) {
      return googleName
    }
  }

  return null
}

/**
 * Generate Google Fonts URL for the theme's fonts
 *
 * @param config - Theme configuration object
 * @returns Google Fonts URL or null if using system fonts only
 */
export function getGoogleFontsUrl(config: ThemeConfig): string | null {
  if (!config) return null

  // Get the effective font from config or preset
  let fontSans: string | undefined

  if (config.light?.fontSans) {
    fontSans = config.light.fontSans
  } else if (config.preset && themePresets[config.preset]) {
    fontSans = themePresets[config.preset].light.fontSans
  }

  const googleFont = extractGoogleFont(fontSans)
  if (!googleFont) return null

  // Request multiple weights for flexibility
  return `https://fonts.googleapis.com/css2?family=${googleFont}:wght@400;500;600;700&display=swap`
}
