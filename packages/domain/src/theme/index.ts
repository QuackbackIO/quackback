/**
 * Theme customization module
 *
 * Provides types, presets, color conversion, and CSS generation
 * for organization portal theming.
 */

// Types
export type { ThemeVariables, ThemeConfig, ThemePreset, CoreThemeVariable } from './types'
export { CORE_THEME_VARIABLES } from './types'

// Presets
export { themePresets, presetNames, primaryPresetIds, getPreset } from './presets'

// Color conversion
export { hexToOklch, oklchToHex, isValidHex, isValidOklch } from './colors'

// CSS generation
export {
  generateThemeCSS,
  parseThemeConfig,
  serializeThemeConfig,
  getGoogleFontsUrl,
} from './generator'
