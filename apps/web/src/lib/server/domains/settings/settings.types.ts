/**
 * Settings configuration types
 *
 * Configuration is stored as JSON in the database for flexibility.
 * This allows adding new settings without migrations.
 */

import type { TiptapContent } from '@/lib/shared/db-types'
import type { OfficeHoursConfig, PreChatEmailMode } from '@/lib/shared/chat/types'

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
   * Workspace-wide two-factor authentication policy.
   *
   * When `required` is true, a password sign-in (or signup) by ANY user
   * whose account has no 2FA enrolled takes them through inline TOTP
   * enrollment inside the auth dialog. An already-enrolled user is
   * challenged for their TOTP code inline instead of receiving a session.
   * There is no role distinction — the policy applies to all roles equally.
   *
   * The dialog does not receive an error from the server. It infers
   * enrollment-needed from this `twoFactor.required` flag combined with
   * the presence of a full session: better-auth withholds the session for
   * enrolled users (returning `twoFactorRedirect`), so a full session
   * under a required-2FA workspace means the user is un-enrolled.
   *
   * This flag gates only the password path. Magic-link, OAuth, and
   * email-OTP sign-ins are not gated — the workspace flag is not a hard
   * guarantee when those methods are also enabled.
   *
   * Default `undefined` is treated as `required=false` (off) so
   * existing tenants pre-migration aren't suddenly locked out.
   */
  twoFactor?: { required: boolean }
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
  /**
   * Owning identity provider (`idp` TypeID). Null/absent until the
   * provider backfill links it — routing/eligibility code resolves the
   * provider from this. Optional so legacy callers that build a domain
   * without it still typecheck.
   */
  providerId?: `idp_${string}` | null
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
 * Portal feature toggles
 */
export interface PortalFeatures {
  /**
   * Workspace-wide master switch for anonymous interaction. When `false`,
   * every board's vote/comment/submit action requires sign-in regardless
   * of its per-board `access` tier — the BoardAccessForm renders the
   * "Anyone" cells as disabled and the server's vote/comment/post
   * handlers refuse anonymous principals up-front. The previous trio of
   * per-action toggles (`anonymousVoting`/`anonymousCommenting`/
   * `anonymousPosting`) was collapsed into this single flag by migration
   * 0084; per-board tiers carry whatever finer-grained restrictions the
   * admin had set under the old shape.
   */
  allowAnonymous: boolean
  /** Allow users to edit posts even after receiving votes/comments */
  allowEditAfterEngagement: boolean
  /** Allow users to delete posts even after receiving votes/comments */
  allowDeleteAfterEngagement: boolean
  /** Show public edit history on posts */
  showPublicEditHistory: boolean
}

/**
 * Workspace-wide post-approval policy. Applies to every board — there is
 * no per-board override.
 */
export interface ModerationDefault {
  requireApproval: 'none' | 'anonymous' | 'authenticated' | 'all'
}

/**
 * Welcome card shown above the post list on the portal index.
 * Title is plain text (server trims + caps at 120 chars). Body is
 * sanitized TipTap JSON — same shape as post / help-center content,
 * sanitized via `sanitizeTiptapContent` on every write.
 *
 * Default off. Renders only when `enabled` and at least one of
 * `title` / `body` has content.
 */
export interface PortalWelcomeCard {
  enabled: boolean
  /** Plain text. Server trims and rejects > 120 chars. */
  title: string
  /** Sanitized TipTap JSON doc. */
  body: TiptapContent
}

/** Max length of {@link PortalWelcomeCard.title} after trimming. */
export const PORTAL_WELCOME_CARD_TITLE_MAX = 120

/**
 * Portal-level access control settings.
 *
 * `allowedDomains`, `widgetSignIn`, and `allowedSegmentIds` are server-only
 * policy. They are read by `evaluateMyPortalAccessFn` server-side and never
 * serialized into the router context or any client payload. The router context
 * carries only `visibility` from this shape (redacted in `__root.tsx`).
 */
export interface PortalAccessConfig {
  visibility: 'public' | 'private'
  /** Email domains whose verified users are automatically granted access. */
  allowedDomains: string[]
  /** Whether widget-authenticated users may access a private portal. */
  widgetSignIn: boolean
  /** Server-only policy. Segments whose members can access a private portal. */
  allowedSegmentIds: string[]
}

/**
 * Portal configuration
 * Controls the public feedback portal behavior
 */
export interface PortalConfig {
  /** Feature toggles */
  features: PortalFeatures
  /** Welcome card on the portal index. Optional — absent = disabled. */
  welcomeCard?: PortalWelcomeCard
  /** Workspace-wide approval policy; applies to every board. */
  moderationDefault: ModerationDefault
  /** Portal-level access control (visibility gate). */
  access?: PortalAccessConfig
  /** Support tab (conversations on the portal). Optional — absent = disabled. */
  support?: PortalSupportConfig
}

/**
 * Portal Support tab configuration. Gated (with the `supportInbox` feature
 * flag) by `isPortalSupportEnabled`; independent of the widget chat toggles.
 */
export interface PortalSupportConfig {
  enabled: boolean
}

/**
 * Default portal config for new organizations
 */
export const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  features: {
    allowEditAfterEngagement: false,
    allowDeleteAfterEngagement: false,
    showPublicEditHistory: false,
    allowAnonymous: true,
  },
  welcomeCard: {
    enabled: false,
    title: '',
    body: { type: 'doc', content: [{ type: 'paragraph' }] },
  },
  moderationDefault: { requireApproval: 'none' },
  access: { visibility: 'public', allowedDomains: [], widgetSignIn: false, allowedSegmentIds: [] },
  support: { enabled: false },
}

/**
 * Fail-closed read of the workspace anonymous-interaction ceiling from a raw
 * (un-merged) `settings.portalConfig`. Only an explicitly-enabled flag permits
 * anonymous vote / comment / submit; a missing flag DENIES — the security gate
 * must not inherit `getPortalConfig`'s permissive merged default. Existing
 * tenants carry an explicit value from migration 0084, and the per-board tier
 * is the inner gate. This is the single source of truth for every anonymous
 * write/read gate so they cannot drift.
 */
export function workspaceAllowsAnonymous(
  portalConfig: string | Record<string, unknown> | null | undefined
): boolean {
  let parsed: unknown = portalConfig
  if (typeof portalConfig === 'string') {
    // A corrupt / empty-string portal_config (a live pre-0084 state — see the
    // migration) must DENY, not throw a 500. Mirrors parseJsonOrNull; the gate
    // stays fail-closed on unparseable config.
    try {
      parsed = JSON.parse(portalConfig)
    } catch {
      return false
    }
  }
  return (
    (parsed as { features?: { allowAnonymous?: boolean } } | null | undefined)?.features
      ?.allowAnonymous === true
  )
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
/** An agent saved reply (canned response). */
export interface CannedReply {
  id: string
  title: string
  body: string
}

/**
 * Chat settings (sub-section of WidgetConfig). Most fields are client-safe
 * and projected into PublicLiveChatConfig; `cannedReplies` is agent-only and is
 * stripped from the public projection (see getPublicWidgetConfig).
 */
export interface LiveChatConfig {
  /** Master toggle for the chat tab + endpoints. */
  enabled: boolean
  /** Greeting shown when a visitor opens chat with no history. */
  welcomeMessage?: string
  /** Shown when no agents are currently available to reply. */
  offlineMessage?: string
  /** Heading shown for the chat tab/view (falls back to the workspace name). */
  teamName?: string
  /** Weekly office hours; when enabled, drives the widget's away state + copy. */
  officeHours?: OfficeHoursConfig
  /** Ask anonymous visitors for an email before chatting ('off' by default). */
  preChatEmail?: PreChatEmailMode
  /** Agent-only saved replies — NEVER projected into the public widget config. */
  cannedReplies?: CannedReply[]
  /** Conversation routing: auto-assign new conversations to an active agent.
   *  Agent-only; never projected into the public config. */
  routing?: {
    enabled: boolean
    /** Only one strategy today: assign to an online agent. */
    strategy: 'auto_assign_active'
  }
}

/** Client-safe subset of LiveChatConfig (drops agent-only fields). */
export type PublicLiveChatConfig = Omit<LiveChatConfig, 'cannedReplies' | 'routing'>

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
    chat?: boolean
    /** Show the aggregated Home tab (defaults to on; only appears with 2+ sections) */
    home?: boolean
  }
  /** Chat settings */
  chat?: LiveChatConfig
}

/**
 * Public subset of widget config — safe to include in TenantSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs'
> & {
  /** Whether verified identity is required (derived from identifyVerification) */
  hmacRequired?: boolean
  /** Client-safe chat config (no agent-only fields like cannedReplies). */
  chat?: PublicLiveChatConfig
}

export const DEFAULT_LIVE_CHAT_CONFIG: LiveChatConfig = {
  enabled: false,
  welcomeMessage: 'Hi! 👋 How can we help you today?',
  offlineMessage: "We're away right now — leave a message and we'll get back to you by email.",
  // Default to capturing an email (optional, non-blocking) so an offline reply
  // can actually reach the visitor. 'off' left the common "type and leave" case
  // with no way to follow up.
  preChatEmail: 'optional',
}

/** A sensible starting schedule for the settings UI: Mon–Fri, 9–5, disabled. */
export const DEFAULT_OFFICE_HOURS: OfficeHoursConfig = {
  enabled: false,
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    enabled: d >= 1 && d <= 5,
    start: '09:00',
    end: '17:00',
  })),
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  enabled: false,
  identifyVerification: false,
  tabs: {
    feedback: true,
    changelog: false,
    chat: false,
    home: true,
  },
  chat: DEFAULT_LIVE_CHAT_CONFIG,
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
    chat?: boolean
    home?: boolean
  }
  chat?: Partial<LiveChatConfig>
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
}

/**
 * Input for updating portal config (partial update)
 */
export interface UpdatePortalConfigInput {
  features?: Partial<PortalFeatures>
  welcomeCard?: Partial<PortalWelcomeCard>
  moderationDefault?: ModerationDefault
  access?: Partial<PortalAccessConfig>
  support?: Partial<PortalSupportConfig>
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
  /** Workspace 2FA policy, surfaced so the auth dialog can drive inline
   *  enrollment after a password sign-in. */
  twoFactor?: { required: boolean }
}

/**
 * Public portal config for portal login forms
 */
export interface PublicPortalConfig {
  features: PortalFeatures
  /**
   * Public OIDC sign-in buttons from the identity_provider table. Each
   * `id` is a provider's `registrationId` (drives
   * `signIn.oauth2({ providerId })`); `name` is its display label. Only
   * button-eligible, registered providers appear — routed-only providers
   * (verified domain + showButton:false) are omitted.
   */
  oidcProviders?: { id: string; name: string }[]
  /** Welcome card on the portal index. Absent / disabled = nothing rendered. */
  welcomeCard?: PortalWelcomeCard
  /**
   * Client-safe access control indicator. `isPrivate` and `widgetSignIn`
   * are exposed so the widget can decide whether to show the "Go to portal"
   * CTA. `allowedDomains` remains server-only.
   */
  portalAccess?: { isPrivate: boolean; widgetSignIn: boolean }
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
  /** Workspace state. INERT — app-level suspension enforcement was removed
   *  (dormant workspaces are scaled to 0 by the control plane; the gateway
   *  serves their hostnames). Nothing reads this anymore. */
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
  /** Help center knowledge base */
  helpCenter: boolean
  /** AI-powered feedback extraction from external sources */
  aiFeedbackExtraction: boolean
  /** Support inbox: live-chat widget channel + unified admin inbox */
  supportInbox: boolean
  /** External link preview cards in chat (OG unfurling) */
  linkPreviews: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  helpCenter: false,
  aiFeedbackExtraction: false,
  supportInbox: false,
  linkPreviews: false,
}

/**
 * Feature flag metadata for the admin UI
 */
export const FEATURE_FLAG_REGISTRY: Record<
  keyof FeatureFlags,
  { label: string; description: string }
> = {
  helpCenter: {
    label: 'Help Center',
    description: 'Publish a searchable help center so customers can find answers on their own.',
  },
  aiFeedbackExtraction: {
    label: 'AI Feedback Extraction',
    description: 'Automatically pull in and categorize feedback from your connected sources.',
  },
  supportInbox: {
    label: 'Conversations',
    description:
      'Let visitors start a live chat from the widget; messages land in a shared inbox your team works from.',
  },
  linkPreviews: {
    label: 'Link Previews',
    description: 'Show Open Graph preview cards below external links shared in chat.',
  },
}

/**
 * Labs page layout: experimental flags grouped into sections, each rendered as
 * a card with a heading + high-level description. Every flag in FeatureFlags
 * must belong to exactly one section (pinned by a test) so a new flag can never
 * silently go unsurfaced.
 */
export const LAB_SECTIONS: Array<{
  title: string
  description: string
  flags: Array<keyof FeatureFlags>
}> = [
  {
    title: 'Support',
    description: 'Support your customers with live chat and a self-serve help center.',
    flags: ['supportInbox', 'helpCenter', 'linkPreviews'],
  },
  {
    title: 'Feedback',
    description: 'Understand your feedback faster, with AI that sorts and categorizes it for you.',
    flags: ['aiFeedbackExtraction'],
  },
]
