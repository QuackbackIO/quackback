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

  let css = ''
  if (lightCSS) {
    css += `:root { ${lightCSS} }`
  }
  if (darkCSS) {
    css += ` .dark { ${darkCSS} }`
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
