/**
 * Settings configuration types
 *
 * Configuration is stored as JSON in the database for flexibility.
 * This allows adding new settings without migrations.
 */

import type { TiptapContent } from '@/lib/shared/db-types'
import type { Role } from '@/lib/shared/roles'
import type { OfficeHoursConfig } from '@/lib/shared/conversation/types'

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
    autoProvisionRole?: Role
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
     * wins against `rules`; when none matches, `resolveSsoRole` returns null
     * and the caller falls back to the provider's `autoProvisionRole` (the
     * per-provider model dropped this blob's `defaultRole`, kept here only for
     * the legacy config shape).
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
      rules: Array<{ whenContains: string; role: Role }>
      /** Used when no rule matches. */
      defaultRole: Role
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
 *    blocked. Toggling `enforced=true` requires a successful test sign-in
 *    through the owning provider (lockout guard) AND active recovery codes —
 *    the break-glass to sign back in if the IdP is ever unavailable.
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
 * flag) by `isPortalSupportEnabled`; independent of the widget messenger toggles.
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
  /**
   * Whether OAuth clients may self-register (RFC 7591 dynamic client
   * registration). Required by MCP clients like Claude Code; disable to
   * restrict OAuth to pre-registered clients. Read at auth-instance build
   * time; updateDeveloperConfig bumps auth_config_version on change so the
   * toggle takes effect without a restart.
   */
  oauthDynamicClientRegistrationEnabled: boolean
}

/**
 * Default developer config — mcpEnabled: true for backward compatibility
 * (existing deployments keep working without explicit opt-in)
 */
export const DEFAULT_DEVELOPER_CONFIG: DeveloperConfig = {
  mcpEnabled: true,
  mcpPortalAccessEnabled: false,
  oauthDynamicClientRegistrationEnabled: true,
}

/**
 * Input for updating developer config (partial update)
 */
export interface UpdateDeveloperConfigInput {
  mcpEnabled?: boolean
  mcpPortalAccessEnabled?: boolean
  oauthDynamicClientRegistrationEnabled?: boolean
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
 * Messenger settings (sub-section of WidgetConfig). Most fields are client-safe
 * and projected into PublicMessengerConfig; `cannedReplies` is agent-only and is
 * stripped from the public projection (see getPublicWidgetConfig).
 */
/**
 * Display identity for the workspace's AI assistant, plus whether it replies.
 * Replies are no longer exclusively from the external agent layer: the assistant
 * may reply in-process as a service principal through a defined tool layer, or
 * out-of-process via the MCP service principal — `respond` gates whether it
 * answers at all. Keep this the single source of the assistant's name/avatar so
 * the future agent principal adopts it rather than adding a second identity.
 */
export interface AssistantIdentityConfig {
  enabled?: boolean
  /** Display name (e.g. "Quinn"). */
  name?: string
  /** Avatar image URL; falls back to an initial when unset. */
  avatarUrl?: string
  /** Whether the assistant actually replies (vs. identity-only). Default false. */
  respond?: boolean
}

export interface MessengerConfig {
  /** Master toggle for the messenger tab + endpoints. */
  enabled: boolean
  /** Greeting shown when a visitor opens the messenger with no history. */
  welcomeMessage?: string
  /** Shown when no agents are currently available to reply. */
  offlineMessage?: string
  /** Heading shown for the messenger tab/view (falls back to the workspace name). */
  teamName?: string
  /** AI-assistant display identity (client-safe). */
  assistant?: AssistantIdentityConfig
  /**
   * @deprecated Migration-only. The canonical office-hours schedule now lives in
   * the `settings.metadata` bag (see settings.office-hours.ts). This field only
   * types the released stored config that the read-time fallback converts; no
   * code writes it and it is not projected into the public widget config.
   */
  officeHours?: OfficeHoursConfig
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

/** Client-safe subset of MessengerConfig (drops agent-only + deprecated fields). */
export type PublicMessengerConfig = Omit<
  MessengerConfig,
  'cannedReplies' | 'routing' | 'officeHours'
>

/**
 * Types of card the widget Home surface can show. Built-in types route to a
 * widget surface and carry sensible default copy; 'link' opens an external URL.
 * Future types (e.g. recent tickets) extend this union.
 */
export type WidgetHomeCardType =
  | 'feedback'
  | 'new_conversation'
  | 'article_search'
  | 'latest_updates'
  | 'link'

/** An ordered, admin-configurable card on the widget Home surface. */
export interface WidgetHomeCard {
  id: string
  type: WidgetHomeCardType
  /** Hidden without being removed (defaults to shown). */
  enabled?: boolean
  /** Override the card's default title (built-in types have default copy). */
  title?: string
  /** Override the card's default subtitle. */
  subtitle?: string
  /** External URL opened in a new tab — 'link' cards only. */
  url?: string
}

/**
 * The Home cards shown when the admin hasn't customised the list: one card per
 * built-in surface, each auto-hidden when its surface is disabled. Shared by
 * the widget renderer and the admin editor (as the seed for customisation).
 */
export const DEFAULT_WIDGET_HOME_CARDS: WidgetHomeCard[] = [
  { id: 'feedback', type: 'feedback' },
  { id: 'new-conversation', type: 'new_conversation' },
  { id: 'article-search', type: 'article_search' },
  { id: 'latest-updates', type: 'latest_updates' },
]

/** Customisation for the aggregated Home surface (greeting, hero, quick links). */
export interface WidgetHomeConfig {
  /** Greeting heading; supports a `{name}` placeholder (e.g. "Hi {name} 👋"). */
  greeting?: string
  /** Subtitle under the greeting (e.g. "How can we help?"). */
  subtitle?: string
  /** Home hero treatment: plain background, a brand-tinted gradient, or an
   *  uploaded image that fades into the content. */
  headerStyle?: 'plain' | 'gradient' | 'image'
  /** S3 key of the uploaded hero image. Written ONLY via saveWidgetHeroImageKey
   *  (single writer owns the S3 object lifecycle) — never through the generic
   *  config update; resolved to `heroImageUrl` in the public projection. */
  heroImageKey?: string
  /** Public URL of the hero image — derived from heroImageKey at projection
   *  time; present only on the public/client side. */
  heroImageUrl?: string | null
  /** Show the workspace logo in the Home header (default on when a logo is set). */
  showLogo?: boolean
  /** Show a small teammate-avatar cluster in the Home header (default on). */
  showTeamAvatars?: boolean
  /** Admin-defined quick-link cards shown below the surface cards. */
  cards?: WidgetHomeCard[]
}

export interface WidgetConfig {
  enabled: boolean
  /** Board slug to filter/default to */
  defaultBoard?: string
  /** Trigger button position */
  position?: 'bottom-right' | 'bottom-left'
  /** Which tabs to show in the widget bottom bar */
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    /** Messenger (the "Messages" tab). */
    messenger?: boolean
    /** Show the aggregated Home tab (defaults to on; only appears with 2+ sections) */
    home?: boolean
  }
  /** Messenger settings, stored under `messenger`. */
  messenger?: MessengerConfig
  /** Home surface customisation (greeting, hero style, quick-link cards). */
  home?: WidgetHomeConfig
}

/**
 * Public subset of widget config — safe to include in TenantSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs' | 'home'
> & {
  /** Always true: identify requires a backend-signed ssoToken (GH issue #300). */
  hmacRequired?: boolean
  /** Client-safe messenger config (no agent-only fields like cannedReplies). */
  messenger?: PublicMessengerConfig
}

export const DEFAULT_MESSENGER_CONFIG: MessengerConfig = {
  enabled: false,
  welcomeMessage: 'Hi! 👋 How can we help you today?',
  offlineMessage: "We're away right now. Leave a message and we'll get back to you by email.",
  // AI-first by default: conversations open fronted by the assistant identity.
  // Admins can rename or disable it under Settings → AI & Automation. `respond`
  // defaults off — identity is on, in-process answering is opt-in.
  assistant: { enabled: true, name: 'Quinn', respond: false },
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  enabled: false,
  tabs: {
    feedback: true,
    changelog: false,
    messenger: false,
    home: true,
  },
  messenger: DEFAULT_MESSENGER_CONFIG,
}

/**
 * Input for updating widget config (partial update)
 */
export interface UpdateWidgetConfigInput {
  enabled?: boolean
  defaultBoard?: string
  position?: 'bottom-right' | 'bottom-left'
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    messenger?: boolean
    home?: boolean
  }
  messenger?: Partial<MessengerConfig>
  home?: WidgetHomeConfig
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
  /** AI answers with citations on help-center search surfaces */
  helpCenterAiAnswers: boolean
  /** AI-powered feedback extraction from external sources */
  aiFeedbackExtraction: boolean
  /** Support inbox: messenger widget channel + unified admin inbox */
  supportInbox: boolean
  /** External link preview cards in conversations (OG unfurling) */
  linkPreviews: boolean
  /** Cookieless visitor + pageview analytics (portal and widget) */
  visitorAnalytics: boolean
  /** Durable first-party device id: connects visitors to leads and users across visits */
  visitorDeviceTracking: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  helpCenter: false,
  helpCenterAiAnswers: false,
  aiFeedbackExtraction: false,
  supportInbox: false,
  linkPreviews: false,
  visitorAnalytics: false,
  visitorDeviceTracking: false,
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
  helpCenterAiAnswers: {
    label: 'Help Center AI Answers',
    description:
      'Let customers ask a question and get an instant AI answer with citations, built only from your published help articles. Requires an AI model to be configured.',
  },
  aiFeedbackExtraction: {
    label: 'AI Feedback Extraction',
    description: 'Automatically pull in and categorize feedback from your connected sources.',
  },
  supportInbox: {
    label: 'Conversations',
    description:
      'Let visitors start a conversation with Messenger from the widget; messages land in a shared inbox your team works from.',
  },
  linkPreviews: {
    label: 'Link Previews',
    description: 'Show Open Graph preview cards below external links shared in conversations.',
  },
  visitorAnalytics: {
    label: 'Visitor Analytics',
    description:
      'Measure visitors and pageviews across your portal and widget without cookies or personal data.',
  },
  visitorDeviceTracking: {
    label: 'Visitor Identity',
    description:
      'Remember returning visitors with a first-party device id so their activity connects to leads and users. Stores an identifier in the browser; check your privacy requirements before enabling.',
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
    description: 'Support your customers with Messenger and a self-serve help center.',
    flags: ['supportInbox', 'helpCenter', 'helpCenterAiAnswers', 'linkPreviews'],
  },
  {
    title: 'Feedback',
    description: 'Understand your feedback faster, with AI that sorts and categorizes it for you.',
    flags: ['aiFeedbackExtraction'],
  },
  {
    title: 'Analytics',
    description: 'Understand who visits your portal and widget, privately and without cookies.',
    flags: ['visitorAnalytics', 'visitorDeviceTracking'],
  },
]
