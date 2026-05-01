/**
 * Settings domain module exports
 *
 * IMPORTANT: This barrel export only includes types and constants.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './settings.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Config types (no DB dependency)
export type {
  OAuthProviders,
  AuthConfig,
  PortalAuthMethods,
  PortalFeatures,
  PortalConfig,
  HeaderDisplayMode,
  ThemeColors,
  BrandingConfig,
  UpdateAuthConfigInput,
  UpdatePortalConfigInput,
  PublicAuthConfig,
  PublicPortalConfig,
  DeveloperConfig,
  UpdateDeveloperConfigInput,
  WidgetConfig,
  PublicWidgetConfig,
  UpdateWidgetConfigInput,
  HelpCenterConfig,
  HelpCenterSeoConfig,
} from './settings.types'

// Default config values (no DB dependency)
export {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_DEVELOPER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_HELP_CENTER_CONFIG,
  DEFAULT_HELP_CENTER_SEO_CONFIG,
} from './settings.types'

// Consolidated tenant settings type (in types.ts to avoid server dep leak via barrel)
export type { TenantSettings, SettingsBrandingData } from './settings.types'

// Tier limits — type + OSS defaults are barrel-safe (no DB dep).
// The resolver service (tier-limits.service.ts) must NOT be exported here;
// import it directly in server-only code to avoid leaking DB into the client bundle.
export type { TierLimits, TierLimit, TierFeatureFlags } from './tier-limits.types'
export { OSS_TIER_LIMITS } from './tier-limits.types'
