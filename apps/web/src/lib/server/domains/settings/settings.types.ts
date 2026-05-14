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
  /**
   * Optional OIDC SSO admin sign-in. Populated from the declarative
   * config file via the reconciler or by the admin auth settings UI.
   * The client *secret* is **not** in this JSON — it lives encrypted
   * in `platform_credentials` with `integrationType='auth_sso'` so a
   * settings-row dump can't leak it.
   */
  ssoOidc?: {
    enabled: boolean
    discoveryUrl: string
    clientId: string
    autoCreateUsers: boolean
    /**
     * Role assigned to a brand-new user on their first SSO sign-in.
     * Only consulted when `autoCreateUsers` is true. Default 'member'.
     * 'user' means "do not promote" (portal user only).
     */
    autoProvisionRole?: 'admin' | 'member' | 'user'
    /**
     * ISO-8601 UTC. Server-stamped whenever a *connection-affecting*
     * field changes — `discoveryUrl`, `clientId`, or the client secret.
     * It is the freshness baseline for {@link lastSuccessfulTestAt}: a
     * successful test only counts if it happened after the most recent
     * details change. Not stamped for `autoCreateUsers` /
     * `autoProvisionRole` / `attributeMapping` — those don't affect
     * whether the IdP handshake works.
     */
    detailsChangedAt?: string
    /**
     * ISO-8601 UTC. Server-stamped by the SSO test callback when a test
     * sign-in succeeds AND the IdP-returned email matches the admin who
     * ran it. Compared against {@link detailsChangedAt} to gate two
     * actions: enabling SSO (`enabled=true`) and per-domain
     * `enforced=true`. Workspace-level — any admin's identity-matched
     * test unlocks the gate for the whole workspace.
     */
    lastSuccessfulTestAt?: string
    /**
     * Optional IdP-attribute → role mapping. When set, the SSO callback
     * resolves the user's role from a claim on the ID token instead of
     * falling back to `autoProvisionRole`. The mapping is first-match-
     * wins against `rules`; nothing matches → `defaultRole`.
     *
     * Resolved on every sign-in when `syncOnEverySignIn=true` so role
     * changes in the IdP propagate down. Default `false` keeps JIT
     * semantics (only first sign-in sets the role).
     */
    attributeMapping?: {
      /** Dotted path or URL-shaped namespaced claim path on the ID token. */
      claimPath: string
      /** First-match-wins. `whenContains` matches when the resolved claim's
       *  array contains the literal (case-insensitive) or its scalar value
       *  equals it. */
      rules: Array<{ whenContains: string; role: 'admin' | 'member' | 'user' }>
      /** Used when no rule matches. */
      defaultRole: 'admin' | 'member' | 'user'
      /** When true, every sign-in re-resolves and may demote/promote. */
      syncOnEverySignIn?: boolean
    }
  }
  /**
   * Workspace-wide two-factor policy for team-role users.
   *
   * When `required` is true, the password sign-in hook redirects any
   * team-role user (`admin` / `member`) without 2FA enrolled to
   * `/auth/two-factor-setup-required`. Portal users (`role='user'`)
   * are never gated. Magic-link remains open as the break-glass for
   * an admin who lost their authenticator — they can get back in,
   * re-enroll, then sign in via password again.
   *
   * Default `undefined` is treated as `required=false` (off) so
   * existing tenants pre-migration aren't suddenly locked out.
   */
  twoFactor?: { required: boolean }
  /**
   * Security defaults that span all team auth methods. Per-workspace
   * toggles so admins with stringent compliance / audit-noise
   * constraints can opt out of the default-on behaviour. Self-hosters
   * who don't have email delivery configured can also turn this off
   * to silence dev-mode console logging.
   */
  security?: {
    /**
     * Send the workspace owner an email when their account signs in
     * from a previously-unseen device (UA + /24 IP subnet bucket).
     * First-line defense against credential compromise — the user
     * notices an unfamiliar sign-in and can revoke the session.
     * Default `true`.
     */
    notifyOnNewSignIn?: boolean
  }
}

/**
 * A workspace's verified SSO domain. Routing semantics:
 *  - `verifiedAt: null` — pending DNS verification, no behaviour change.
 *  - `verifiedAt: <ISO>` — emails at this domain are routed to SSO by
 *    default on the login form.
 *  - `enforced: true` (with `verifiedAt: <ISO>`) — emails at this domain
 *    are hard-bound to SSO; password / magic-link / non-SSO OAuth are
 *    blocked. Toggling `enforced=true` requires the calling admin to
 *    have signed in via SSO within the bootstrap window (lockout guard)
 *    AND email-delivery configured (break-glass precondition).
 */
export interface VerifiedDomain {
  id: `domain_${string}`
  /** Canonical lowercase ASCII FQDN — `normalizeDomain` output. */
  name: string
  /** Random token, intentionally public via DNS TXT. */
  verificationToken: string
  /** ISO-8601 UTC. Null = pending verification. */
  verifiedAt: string | null
  /** Per-domain hard-binding switch. Default false. */
  enforced: boolean
  /** ISO-8601 UTC. */
  createdAt: string
}

/**
 * Default auth config for new organizations.
 *
 * `password: true` matches the prior hardcoded behaviour in v0.9.9 and
 * earlier, where team password sign-in was always allowed regardless
 * of any stored config. Pre-upgrade tenants whose `authConfig.oauth`
 * has no `password` key also fall back to this default via the
 * `?? true` check in `isAuthMethodAllowed`, so upgrading from v0.9.9
 * doesn't lock admins out of their team surface.
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  oauth: {
    google: true,
    github: true,
    password: true,
  },
  openSignup: false,
}

// =============================================================================
// Portal Configuration (Public feedback portal settings)
// =============================================================================

/**
 * Portal auth settings — `password`, `magicLink`, and dynamic OAuth provider toggles.
 *
 * The legacy `email` flag (Email OTP) was retired in migration 0049 in
 * favour of `magicLink`. Existing portal_config blobs may still carry
 * `email: false` after the migration; the index signature accepts it so
 * we don't trip TypeScript when reading legacy data.
 */
export interface PortalAuthMethods {
  /** Whether password authentication is enabled (defaults to true) */
  password?: boolean
  /** Whether one-click magic-link sign-in is enabled. The magicLink
   * better-auth plugin is always wired (used by team invitations);
   * this toggle controls whether the portal login UI surfaces it as a
   * sign-in option. Defaults to off so the only auth surface is what
   * the admin has explicitly chosen. */
  magicLink?: boolean
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
  /** Whether rich media (images, tables, embeds) is enabled in the admin post editor */
  richMediaInPosts?: boolean
  /** Whether YouTube/video embeds are enabled in the admin post editor (only applies when richMediaInPosts is true) */
  videoEmbedsInPosts?: boolean
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
  /** Whether to require app-signed identity instead of inline email capture */
  identifyVerification?: boolean
  /** Which tabs to show in the widget bottom bar */
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
  }
  /** Whether authenticated widget users can upload images in feedback submissions */
  imageUploadsInWidget?: boolean
}

/**
 * Public subset of widget config — safe to include in TenantSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs' | 'imageUploadsInWidget'
> & {
  /** Whether verified identity is required (derived from identifyVerification) */
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
    help?: boolean
  }
  imageUploadsInWidget?: boolean
}

// =============================================================================
// Help Center Configuration (Standalone knowledge base)
// =============================================================================

/**
 * SEO configuration for the help center
 */
export interface HelpCenterSeoConfig {
  metaDescription: string
  sitemapEnabled: boolean
  structuredDataEnabled: boolean
  ogImageKey: string | null
}

export const DEFAULT_HELP_CENTER_SEO_CONFIG: HelpCenterSeoConfig = {
  metaDescription: '',
  sitemapEnabled: true,
  structuredDataEnabled: true,
  ogImageKey: null,
}

/**
 * Help center configuration
 * Controls the inline knowledge base behavior (always public, always inside the portal)
 */
export interface HelpCenterConfig {
  enabled: boolean
  homepageTitle: string
  homepageDescription: string
  seo: HelpCenterSeoConfig
}

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  enabled: false,
  homepageTitle: 'How can we help?',
  homepageDescription: 'Search our knowledge base or browse by category',
  seo: DEFAULT_HELP_CENTER_SEO_CONFIG,
}

// =============================================================================
// Update Input Types
// =============================================================================

/**
 * Input for updating auth config (partial update). Each top-level key
 * is optional; nested ssoOidc is per-key partial too. The mutator
 * deep-merges over the stored value and re-validates the merged
 * result, so a partial like `{ ssoOidc: { enforced: true } }` works
 * provided the stored ssoOidc already has the required fields.
 */
export interface UpdateAuthConfigInput {
  oauth?: OAuthProviders
  openSignup?: boolean
  ssoOidc?: Partial<NonNullable<AuthConfig['ssoOidc']>>
  twoFactor?: Partial<NonNullable<AuthConfig['twoFactor']>>
  security?: Partial<NonNullable<AuthConfig['security']>>
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
  /** Help center configuration */
  helpCenterConfig: HelpCenterConfig
  /** Public widget config (no secret, safe for client) */
  publicWidgetConfig: PublicWidgetConfig
  /** Feature flags for experimental features */
  featureFlags: FeatureFlags
  brandingData: SettingsBrandingData
  faviconData: { url: string } | null
  /** Dot-paths managed by `/etc/quackback/config.yaml`. Matching in-app
   *  form controls render disabled when the path appears here. Empty
   *  list = nothing locked. */
  managedFieldPaths: string[]
  /** Verified SSO domains ordered by creation. Empty when no domains
   *  have been added. The auth runtime reads this to decide routing
   *  (sso-default vs methods) and hard-binding (per-row `enforced`). */
  verifiedDomains: VerifiedDomain[]
  /** Workspace state, written by the config-file reconciler when
   *  spec.state is set. Defaults to 'active' when the column has never
   *  been written. */
  state: 'active' | 'suspended' | 'deleting'
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
