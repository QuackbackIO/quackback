/**
 * Input/Output types for OrganizationService operations
 */

import type { PermissionLevel } from '@quackback/db/types'

/**
 * Security settings for organization authentication
 */
export interface SecuritySettings {
  passwordAuthEnabled: boolean
  googleOAuthEnabled: boolean
  githubOAuthEnabled: boolean
  microsoftOAuthEnabled: boolean
}

/**
 * Input for updating security settings
 */
export interface UpdateSecurityInput {
  passwordAuthEnabled?: boolean
  googleOAuthEnabled?: boolean
  githubOAuthEnabled?: boolean
  microsoftOAuthEnabled?: boolean
}

/**
 * Portal authentication settings
 */
export interface PortalAuthSettings {
  portalAuthEnabled: boolean
  portalPasswordEnabled: boolean
  portalGoogleEnabled: boolean
  portalGithubEnabled: boolean
  portalVoting: PermissionLevel
  portalCommenting: PermissionLevel
  portalSubmissions: PermissionLevel
}

/**
 * Input for updating portal auth settings
 */
export interface UpdatePortalAuthInput {
  portalAuthEnabled?: boolean
  portalPasswordEnabled?: boolean
  portalGoogleEnabled?: boolean
  portalGithubEnabled?: boolean
  portalVoting?: PermissionLevel
  portalCommenting?: PermissionLevel
  portalSubmissions?: PermissionLevel
}

/**
 * Theme configuration for organization
 */
export interface ThemeConfig {
  preset?: string
  light?: ThemeVariables
  dark?: ThemeVariables
}

/**
 * Theme color variables
 */
export interface ThemeVariables {
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
  organizationId: string
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

/**
 * Public auth config for login forms (no secrets)
 */
export interface PublicAuthConfig {
  passwordEnabled: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  microsoftEnabled: boolean
  openSignupEnabled: boolean
  ssoProviders: Array<{ providerId: string; issuer: string; domain: string }>
}

/**
 * Portal public auth config (no secrets)
 */
export interface PortalPublicAuthConfig {
  portalAuthEnabled: boolean
  passwordEnabled: boolean
  googleEnabled: boolean
  githubEnabled: boolean
  voting: PermissionLevel
  commenting: PermissionLevel
  submissions: PermissionLevel
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

/**
 * Public permission check result for voting/commenting/submissions
 */
export interface InteractionPermission {
  permission: PermissionLevel
  isMember: boolean
  member?: { id: string; role: string }
}
