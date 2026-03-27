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
 * OAuth provider settings — dynamic provider support.
 * Keys are Better Auth provider IDs (github, google, discord, etc.).
 */
export interface OAuthProviders {
  [providerId: string]: boolean | undefined
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
 * Portal OAuth settings — dynamic provider support.
 * 'email' controls email OTP; all other keys are Better Auth provider IDs.
 */
export interface PortalAuthMethods {
  /** Whether password authentication is enabled (defaults to true) */
  password?: boolean
  /** Whether email OTP authentication is enabled (defaults to false for new installs) */
  email?: boolean
  /** Dynamic OAuth provider toggles keyed by provider ID (github, google, discord, etc.) */
  [providerId: string]: boolean | undefined
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
  /** Whether unauthenticated visitors can vote without signing in */
  anonymousVoting: boolean
  /** Whether unauthenticated visitors can comment without signing in */
  anonymousCommenting: boolean
  /** Whether unauthenticated visitors can create posts without signing in */
  anonymousPosting: boolean
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
    password: true,
    email: false,
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
    anonymousVoting: true,
    anonymousCommenting: false,
    anonymousPosting: false,
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
  /** Border radius CSS variable value */
  radius?: string
}

/**
 * Theme mode - controls how light/dark mode is handled on the portal
 */
export type ThemeMode = 'light' | 'dark' | 'user'

/**
 * Branding/theme configuration
 */
export interface BrandingConfig {
  /** Theme preset name */
  preset?: string
  /** Theme mode: 'light' (force light), 'dark' (force dark), or 'user' (allow toggle) */
  themeMode?: ThemeMode
  /** Light mode color overrides */
  light?: ThemeColors
  /** Dark mode color overrides */
  dark?: ThemeColors
}

// =============================================================================
// Developer Configuration (MCP server, API settings)
// =============================================================================

/**
 * Developer configuration
 * Controls developer-facing features like the MCP server
 */
export interface DeveloperConfig {
  mcpEnabled: boolean
  /** Whether portal users (role: 'user') can access MCP */
  mcpPortalAccessEnabled: boolean
}

/**
 * Default developer config — mcpEnabled: true for backward compatibility
 * (existing deployments keep working without explicit opt-in)
 */
export const DEFAULT_DEVELOPER_CONFIG: DeveloperConfig = {
  mcpEnabled: true,
  mcpPortalAccessEnabled: false,
}

/**
 * Input for updating developer config (partial update)
 */
export interface UpdateDeveloperConfigInput {
  mcpEnabled?: boolean
  mcpPortalAccessEnabled?: boolean
}

// =============================================================================
// Widget Configuration (Embeddable feedback widget)
// =============================================================================

/**
 * Widget configuration
 * Controls the embeddable feedback widget behavior
 * Note: widgetSecret is stored in its own DB column, NOT here
 */
export interface WidgetConfig {
  enabled: boolean
  /** Board slug to filter/default to */
  defaultBoard?: string
  /** Trigger button position */
  position?: 'bottom-right' | 'bottom-left'
  /** Whether to require HMAC verification on identify calls */
  identifyVerification?: boolean
  /** Which tabs to show in the widget bottom bar */
  tabs?: {
    feedback?: boolean
    changelog?: boolean
  }
}

/**
 * Public subset of widget config — safe to include in TenantSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs'
> & {
  /** Whether HMAC verification is required (derived from identifyVerification) */
  hmacRequired?: boolean
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  enabled: false,
  identifyVerification: false,
  tabs: {
    feedback: true,
    changelog: false,
  },
}

/**
 * Input for updating widget config (partial update)
 */
export interface UpdateWidgetConfigInput {
  enabled?: boolean
  defaultBoard?: string
  position?: 'bottom-right' | 'bottom-left'
  identifyVerification?: boolean
  tabs?: {
    feedback?: boolean
    changelog?: boolean
  }
}

// =============================================================================
// Update Input Types
// =============================================================================

/**
 * Input for updating auth config (partial update)
 */
export interface UpdateAuthConfigInput {
  oauth?: OAuthProviders
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
  /** Display name overrides for generic OAuth providers (e.g. custom-oidc → "Okta") */
  customProviderNames?: Record<string, string>
}

/**
 * Public portal config for portal login forms
 */
export interface PublicPortalConfig {
  oauth: PortalAuthMethods
  features: PortalFeatures
  /** Display name overrides for generic OAuth providers (e.g. custom-oidc → "Okta") */
  customProviderNames?: Record<string, string>
}

// =============================================================================
// Branding Data (client-safe subset of settings)
// =============================================================================

export interface SettingsBrandingData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  headerLogoUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

// =============================================================================
// Tenant Settings (consolidated settings object)
// =============================================================================

/**
 * Consolidated tenant settings, parsed from the database settings row.
 * This interface is client-safe (no DB types) and can be imported from the barrel.
 */
export interface TenantSettings {
  /** Raw settings record from database (opaque on client, typed on server) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: Record<string, any>
  /** Workspace name */
  name: string
  /** Workspace slug */
  slug: string
  authConfig: AuthConfig
  portalConfig: PortalConfig
  brandingConfig: BrandingConfig
  developerConfig: DeveloperConfig
  /** Custom CSS for portal styling */
  customCss: string
  publicAuthConfig: PublicAuthConfig
  publicPortalConfig: PublicPortalConfig
  /** Public widget config (no secret, safe for client) */
  publicWidgetConfig: PublicWidgetConfig
  /** Feature flags for experimental features */
  featureFlags: FeatureFlags
  brandingData: SettingsBrandingData
  faviconData: { url: string } | null
}

// =============================================================================
// Feature Flags (Experimental features)
// =============================================================================

/**
 * Feature flags for experimental/in-development features.
 * New flags default to false. When a feature is ready for rollout,
 * enable it via migration. Eventually remove the flag entirely.
 */
export interface FeatureFlags {
  /** Analytics dashboard in admin panel */
  analytics: boolean
  /** Help center knowledge base */
  helpCenter: boolean
  /** AI-powered feedback extraction from external sources */
  aiFeedbackExtraction: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  analytics: false,
  helpCenter: false,
  aiFeedbackExtraction: false,
}

/**
 * Feature flag metadata for the admin UI
 */
export const FEATURE_FLAG_REGISTRY: Record<
  keyof FeatureFlags,
  { label: string; description: string }
> = {
  analytics: {
    label: 'Analytics Dashboard',
    description: 'View feedback trends, top posts, and engagement metrics from the admin panel.',
  },
  helpCenter: {
    label: 'Help Center',
    description: 'Create and manage a knowledge base with categories and articles for your users.',
  },
  aiFeedbackExtraction: {
    label: 'AI Feedback Extraction',
    description:
      'Automatically extract and categorize feedback from connected sources using large language models.',
  },
}
