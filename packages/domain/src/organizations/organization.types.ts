/**
 * Organization configuration types
 *
 * Configuration is stored as JSON in the database for flexibility.
 * This allows adding new settings without migrations.
 */

import type { OrgId } from '@quackback/ids'

// =============================================================================
// Auth Configuration (Team sign-in settings)
// =============================================================================

/**
 * OAuth provider settings
 */
export interface OAuthProviders {
  google: boolean
  github: boolean
  microsoft: boolean
}

/**
 * Team authentication configuration
 * Controls how team members (owner/admin/member roles) can sign in
 */
export interface AuthConfig {
  /** Which OAuth providers are enabled for team sign-in */
  oauth: OAuthProviders
  /** Whether SSO is required (disables other auth methods) */
  ssoRequired: boolean
  /** Allow public signup vs invitation-only */
  openSignup: boolean
}

/**
 * Default auth config for new organizations
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  oauth: {
    google: true,
    github: true,
    microsoft: true,
  },
  ssoRequired: false,
  openSignup: false,
}

// =============================================================================
// Portal Configuration (Public feedback portal settings)
// =============================================================================

/**
 * Portal OAuth settings (subset of providers available to portal users)
 */
export interface PortalOAuthProviders {
  google: boolean
  github: boolean
}

/**
 * Portal feature toggles
 */
export interface PortalFeatures {
  /** Whether unauthenticated users can view the portal */
  publicView: boolean
  /** Whether portal users can submit new posts */
  submissions: boolean
  /** Whether portal users can comment on posts */
  comments: boolean
  /** Whether portal users can vote on posts */
  voting: boolean
}

/**
 * Portal configuration
 * Controls the public feedback portal behavior
 */
export interface PortalConfig {
  /** OAuth providers for portal user sign-in */
  oauth: PortalOAuthProviders
  /** Feature toggles */
  features: PortalFeatures
}

/**
 * Default portal config for new organizations
 */
export const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  oauth: {
    google: true,
    github: true,
  },
  features: {
    publicView: true,
    submissions: true,
    comments: true,
    voting: true,
  },
}

// =============================================================================
// Branding Configuration (Theme and visual customization)
// =============================================================================

/**
 * Header display mode - how the brand appears in the portal navigation header
 */
export type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

/**
 * Default header display mode
 */
export const DEFAULT_HEADER_DISPLAY_MODE: HeaderDisplayMode = 'logo_and_name'

/**
 * Theme color variables
 */
export interface ThemeColors {
  background?: string
  foreground?: string
  card?: string
  cardForeground?: string
  popover?: string
  popoverForeground?: string
  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  muted?: string
  mutedForeground?: string
  accent?: string
  accentForeground?: string
  destructive?: string
  destructiveForeground?: string
  border?: string
  input?: string
  ring?: string
  sidebarBackground?: string
  sidebarForeground?: string
  sidebarPrimary?: string
  sidebarPrimaryForeground?: string
  sidebarAccent?: string
  sidebarAccentForeground?: string
  sidebarBorder?: string
  sidebarRing?: string
  chart1?: string
  chart2?: string
  chart3?: string
  chart4?: string
  chart5?: string
}

/**
 * Branding/theme configuration
 */
export interface BrandingConfig {
  /** Theme preset name */
  preset?: string
  /** Light mode color overrides */
  light?: ThemeColors
  /** Dark mode color overrides */
  dark?: ThemeColors
}

// =============================================================================
// Update Input Types
// =============================================================================

/**
 * Input for updating auth config (partial update)
 */
export interface UpdateAuthConfigInput {
  oauth?: Partial<OAuthProviders>
  ssoRequired?: boolean
  openSignup?: boolean
}

/**
 * Input for updating portal config (partial update)
 */
export interface UpdatePortalConfigInput {
  oauth?: Partial<PortalOAuthProviders>
  features?: Partial<PortalFeatures>
}

// =============================================================================
// SSO Provider Types
// =============================================================================

/**
 * OIDC provider configuration
 */
export interface OidcConfig {
  clientId: string
  clientSecret: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
}

/**
 * SAML provider configuration
 */
export interface SamlConfig {
  ssoUrl: string
  certificate: string
  signRequest: boolean
}

/**
 * SSO provider record
 */
export interface SsoProvider {
  id: string
  organizationId: OrgId
  providerId: string
  issuer: string
  domain: string
  oidcConfig: OidcConfig | null
  samlConfig: SamlConfig | null
  createdAt: Date
  updatedAt: Date
}

/**
 * SSO provider with masked secrets for API responses
 */
export interface SsoProviderResponse extends Omit<SsoProvider, 'oidcConfig'> {
  oidcConfig: (Omit<OidcConfig, 'clientSecret'> & { clientSecret: string }) | null
}

/**
 * Input for creating SSO provider
 */
export interface CreateSsoProviderInput {
  type: 'oidc' | 'saml'
  issuer: string
  domain: string
  oidcConfig?: OidcConfig
  samlConfig?: SamlConfig
}

/**
 * Input for updating SSO provider
 */
export interface UpdateSsoProviderInput {
  issuer?: string
  domain?: string
  oidcConfig?: Partial<OidcConfig>
  samlConfig?: Partial<SamlConfig>
}

// =============================================================================
// Public API Response Types (no secrets)
// =============================================================================

/**
 * Public auth config for team login forms
 */
export interface PublicAuthConfig {
  oauth: OAuthProviders
  openSignup: boolean
  ssoProviders: Array<{ providerId: string; issuer: string; domain: string }>
}

/**
 * Public portal config for portal login forms
 */
export interface PublicPortalConfig {
  oauth: PortalOAuthProviders
  features: PortalFeatures
}

/**
 * SSO check result
 */
export interface SsoCheckResult {
  hasSso: boolean
  providerId: string
  issuer: string
  domain: string
}
