// @quackback/shared - Shared utilities, types, and constants

// String utilities
export { getInitials } from './string'

// Constants
export { REACTION_EMOJIS, type ReactionEmoji } from './constants'

// Theme customization - namespace export
export * as theme from './theme'

// Theme types - direct exports for easier importing
export type { ThemeVariables, ThemeConfig, ThemePreset, CoreThemeVariable } from './theme'
export { CORE_THEME_VARIABLES } from './theme'
