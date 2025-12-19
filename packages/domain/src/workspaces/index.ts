/**
 * Workspace domain module exports
 */

export { WorkspaceService, workspaceService } from './workspace.service'
export { WorkspaceError } from './workspace.errors'
export type { WorkspaceErrorCode } from './workspace.errors'

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
  OidcConfig,
  SamlConfig,
  SsoProvider,
  SsoProviderResponse,
  CreateSsoProviderInput,
  UpdateSsoProviderInput,
  PublicAuthConfig,
  PublicPortalConfig,
  SsoCheckResult,
} from './workspace.types'

// Default config values
export {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_HEADER_DISPLAY_MODE,
} from './workspace.types'
