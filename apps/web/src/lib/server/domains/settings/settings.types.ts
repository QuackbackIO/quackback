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
}

/**
 * Team authentication configuration
 * Controls how team members (admin/member roles) can sign in
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
  },
  openSignup: false,
}

// =============================================================================
// Portal Configuration (Public feedback portal settings)
// =============================================================================

/**
 * Portal OAuth settings (subset of providers available to portal users)
 */
export interface PortalAuthMethods {
  /** Whether email OTP authentication is enabled (defaults to true for backwards compatibility) */
  email?: boolean
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

/**
 * Portal configuration
 * Controls the public feedback portal behavior
 */
export interface PortalConfig {
  /** OAuth providers for portal user sign-in */
  oauth: PortalAuthMethods
  /** Feature toggles */
  features: PortalFeatures
}

/**
 * Default portal config for new organizations
 */
export const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  oauth: {
    email: true,
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
  oauth?: Partial<PortalAuthMethods>
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
  oauth: PortalAuthMethods
  features: PortalFeatures
}
