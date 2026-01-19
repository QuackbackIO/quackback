/**
 * Settings configuration types
 *
 * Configuration is stored as JSON in the database for flexibility.
 * This allows adding new settings without migrations.
 */

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
  /** Allow users to edit posts even after receiving votes/comments */
  allowEditAfterEngagement: boolean
  /** Allow users to delete posts even after receiving votes/comments */
  allowDeleteAfterEngagement: boolean
  /** Show public edit history on posts */
  showPublicEditHistory: boolean
}

// =============================================================================
// OIDC Configuration (Tenant-specific identity provider)
// =============================================================================

/** Default OIDC scopes */
export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile']

/**
 * Full OIDC config (stored in portalConfig JSON)
 * Contains all settings including encrypted secret
 */
export interface OIDCProviderConfig {
  /** Whether OIDC is enabled for this workspace */
  enabled: boolean
  /** Display name shown on login button (e.g., "Sign in with Acme Corp") */
  displayName: string
  /** OIDC issuer URL (e.g., https://auth.acmecorp.com) */
  issuer: string
  /** OAuth client ID from the IdP */
  clientId: string
  /** Encrypted client secret (AES-256-GCM) */
  clientSecretEncrypted: string
  /** OAuth scopes to request (defaults to DEFAULT_OIDC_SCOPES) */
  scopes?: string[]
  /** Optional email domain restriction (e.g., "acmecorp.com") */
  emailDomain?: string
}

/**
 * Public OIDC config (no secrets - for portal login page)
 */
export interface PublicOIDCConfig {
  enabled: boolean
  displayName: string
}

/**
 * Admin OIDC config (for settings page - shows hasSecret flag, not actual secret)
 */
export interface AdminOIDCConfig {
  enabled: boolean
  displayName: string
  issuer: string
  clientId: string
  /** Indicates whether a secret is configured (true if secret exists) */
  hasSecret: boolean
  scopes?: string[]
  emailDomain?: string
}

/**
 * Input for updating OIDC config (partial update)
 */
export interface UpdateOIDCConfigInput {
  enabled?: boolean
  displayName?: string
  issuer?: string
  clientId?: string
  /** Plain text secret - will be encrypted before storage */
  clientSecret?: string
  scopes?: string[]
  emailDomain?: string
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
  /** Custom OIDC provider configuration (optional) */
  oidc?: OIDCProviderConfig
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
    allowEditAfterEngagement: false,
    allowDeleteAfterEngagement: false,
    showPublicEditHistory: false,
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
// Public API Response Types (no secrets)
// =============================================================================

/**
 * Public auth config for team login forms
 */
export interface PublicAuthConfig {
  oauth: OAuthProviders
  openSignup: boolean
}

/**
 * Public portal config for portal login forms
 */
export interface PublicPortalConfig {
  oauth: PortalOAuthProviders
  features: PortalFeatures
  /** Public OIDC config (no secrets) for displaying custom SSO button */
  oidc?: PublicOIDCConfig
}

// =============================================================================
// Security Configuration (Team SSO and auth method restrictions)
// =============================================================================

/**
 * SSO enforcement level
 * - optional: Team can use SSO or other methods
 * - required: Team must use SSO (admins can bypass via email)
 */
export type SSOEnforcement = 'optional' | 'required'

/**
 * Team sign-in method configuration
 * Controls which authentication methods are available for team sign-in
 */
export interface TeamSocialLoginConfig {
  email: boolean
  github: boolean
  google: boolean
}

/**
 * Full security configuration (stored in database)
 * Contains all settings including encrypted SSO provider config
 */
export interface SecurityConfig {
  /** SSO configuration for team sign-in */
  sso: {
    enabled: boolean
    enforcement: SSOEnforcement
    /** OIDC provider config (reuses existing type) */
    provider?: OIDCProviderConfig
  }
  /** Social login toggles for team members */
  teamSocialLogin: TeamSocialLoginConfig
}

/**
 * Default security config for new organizations
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  sso: {
    enabled: false,
    enforcement: 'optional',
  },
  teamSocialLogin: {
    email: true,
    github: true,
    google: true,
  },
}

/**
 * Public security config (no secrets - for team login page)
 */
export interface PublicSecurityConfig {
  sso: {
    enabled: boolean
    enforcement: SSOEnforcement
    /** Display name for SSO button */
    displayName?: string
  }
  teamSocialLogin: TeamSocialLoginConfig
}

/**
 * Admin security config (for settings page - shows hasSecret flag, not actual secret)
 */
export interface AdminSecurityConfig {
  sso: {
    enabled: boolean
    enforcement: SSOEnforcement
    /** Admin view of OIDC config (has hasSecret flag, no actual secret) */
    provider?: AdminOIDCConfig
  }
  teamSocialLogin: TeamSocialLoginConfig
}

/**
 * Input for updating security config (partial update)
 */
export interface UpdateSecurityConfigInput {
  sso?: {
    enabled?: boolean
    enforcement?: SSOEnforcement
    provider?: UpdateOIDCConfigInput
  }
  teamSocialLogin?: Partial<TeamSocialLoginConfig>
}
