/**
 * Settings domain module exports
 */

export {
  SettingsService,
  settingsService,
  WorkspaceService,
  workspaceService,
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
export {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_HEADER_DISPLAY_MODE,
} from './settings.types'
