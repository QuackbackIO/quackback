/**
 * @quackback/domain
 *
 * Business logic and domain services for Quackback.
 *
 * This is the domain core - the single source of truth for:
 * - Business constants (PostStatus, StatusCategory, ReactionEmoji)
 * - Pricing and feature flags
 * - Theme configuration
 * - Domain services (PostService, BoardService, etc.)
 * - Domain types (PublicPostDetail, TeamMember, etc.)
 */

// Core types barrel - re-exports constants and DB types
export * from './types'

// Utilities
export * from './utils'

// Feature flags and tiers
export * from './features'

// Theme customization - namespace export for cleaner API
export * as theme from './theme'

// Theme types - direct exports for convenience
export type { ThemeVariables, ThemeConfig, ThemePreset, CoreThemeVariable } from './theme'
export { CORE_THEME_VARIABLES } from './theme'

// Shared service utilities
export * from './shared'

// Domain modules (services, errors, and module-specific types)
export * from './posts'
export * from './boards'
export * from './statuses'
export * from './tags'
export * from './comments'
export * from './members'
export * from './organizations'
export * from './permissions'
