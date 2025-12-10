/**
 * Organization domain module exports
 */

export { OrganizationService, organizationService } from './organization.service'
export { OrgError } from './organization.errors'
export type { OrgErrorCode } from './organization.errors'

// Config types
export type {
  OAuthProviders,
  AuthConfig,
  PortalOAuthProviders,
  PortalFeatures,
  PortalConfig,
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
} from './organization.types'

// Default config values
export { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './organization.types'
