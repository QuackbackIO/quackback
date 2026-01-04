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
} from './settings.types'

// Default config values (no DB dependency)
export { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './settings.types'
