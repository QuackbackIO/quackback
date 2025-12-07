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

// Feature flags and pricing tiers
export {
  Feature,
  type PricingTier,
  type TierConfig,
  type DeploymentMode,
  TIER_CONFIG,
  getFeaturesForTier,
  tierHasFeature,
  getMinimumTierForFeature,
  getTierConfig,
  isTierAtLeast,
  ENTERPRISE_CODE_FEATURES,
  requiresEnterpriseCode,
  // Deployment mode (self-hosted vs cloud)
  isSelfHosted,
  getDeploymentMode,
} from './features'
