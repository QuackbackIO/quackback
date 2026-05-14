/**
 * Settings-related types for client use.
 *
 * Re-exported from the server domain for architectural compliance — type-only
 * imports are erased at compile time and never affect the bundle.
 *
 * Note: FEATURE_FLAG_REGISTRY and DEFAULT_PORTAL_CONFIG are runtime constants
 * also re-exported here because settings.types has no DB dependencies and the
 * constants are needed in route files and components.
 */

export type {
  PortalAuthMethods,
  TenantSettings,
  HelpCenterConfig,
  AuthConfig,
  VerifiedDomain,
} from '@/lib/server/domains/settings'

// FeatureFlags and FEATURE_FLAG_REGISTRY live only in settings.types (not barrel-exported)
export type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

// Runtime constants — safe because settings.types has no DB dependencies
export {
  FEATURE_FLAG_REGISTRY,
  DEFAULT_PORTAL_CONFIG,
} from '@/lib/server/domains/settings/settings.types'
