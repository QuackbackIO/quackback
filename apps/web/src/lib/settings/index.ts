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
  PortalOAuthProviders,
  PortalFeatures,
  PortalConfig,
  HeaderDisplayMode,
  ThemeColors,
  BrandingConfig,
  UpdateAuthConfigInput,
  UpdatePortalConfigInput,
  PublicAuthConfig,
  PublicPortalConfig,
  // OIDC types
  OIDCProviderConfig,
  PublicOIDCConfig,
  AdminOIDCConfig,
  UpdateOIDCConfigInput,
  // Security types
  SSOEnforcement,
  TeamSocialLoginConfig,
  SecurityConfig,
  PublicSecurityConfig,
  AdminSecurityConfig,
  UpdateSecurityConfigInput,
} from './settings.types'

// Default config values (no DB dependency)
export {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_OIDC_SCOPES,
  DEFAULT_SECURITY_CONFIG,
} from './settings.types'

// Consolidated settings types (for use with getSettingsWithAllConfigs)
export type { SettingsWithAllConfigs, SettingsBrandingData } from './settings.service'
