/**
 * Settings domain module exports
 */

export {
  getAuthConfig,
  updateAuthConfig,
  getPortalConfig,
  updatePortalConfig,
  getBrandingConfig,
  updateBrandingConfig,
  getCustomCss,
  updateCustomCss,
  uploadLogo,
  deleteLogo,
  uploadHeaderLogo,
  deleteHeaderLogo,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  getPublicAuthConfig,
  getPublicPortalConfig,
} from './settings.service'
export { SettingsError, WorkspaceError } from './settings.errors'
export type { SettingsErrorCode, WorkspaceErrorCode } from './settings.errors'

// Config types
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

// Default config values
export { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './settings.types'
