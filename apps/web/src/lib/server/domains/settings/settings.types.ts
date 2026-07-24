/**
 * Settings configuration types
 *
 * Configuration is stored as JSON in the database for flexibility.
 * This allows adding new settings without migrations.
 */

import type { TiptapContent } from '@/lib/shared/db-types'
import type { Role } from '@/lib/shared/roles'
import type { OfficeHoursConfig } from '@/lib/shared/conversation/types'
import type { WidgetTranslations } from '@/lib/shared/widget/translations'
import type { ChangelogSettings } from '@/lib/shared/changelog-settings'
import type { StatusSettings } from '@/lib/shared/status-settings'

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
 * Types of tab the portal top-nav can show. Built-in types map to fixed
 * portal routes and keep their localized labels; 'link' is an admin-defined
 * external link.
 */
export type PortalNavItemType =
  | 'feedback'
  | 'roadmap'
  | 'changelog'
  | 'help'
  | 'support'
  | 'status'
  | 'link'

/** An ordered, admin-configurable tab in the portal top-nav. */
export interface PortalNavItemConfig {
  /** Built-ins use their type as a stable id; links get a generated UUID. */
  id: string
  type: PortalNavItemType
  /** Hidden without being removed (defaults to shown). */
  enabled?: boolean
  /** Label override. Built-ins without an override keep their i18n label.
   *  Overrides are single-language plain text (same policy as widget Home
   *  card title overrides). */
  label?: string
  /** 'link' only. Absolute http(s) URL. */
  url?: string
  /** 'link' only. Defaults true. */
  newTab?: boolean
}

/**
 * Portal top-nav customization. Absent (or empty items) = default order and
 * visibility, i.e. the behavior before this setting existed. Kept a sibling
 * of `access` — the access block is redacted from client payloads and nav
 * must reach every portal visitor.
 */
export interface PortalNavConfig {
  /** Ordered. Saved wholesale — never patch single items. */
  items?: PortalNavItemConfig[]
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
  /** Top-nav customization. Optional — absent = default tabs. */
  nav?: PortalNavConfig
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
/**
 * Messenger settings (sub-section of WidgetConfig). Most fields are client-safe
 * and projected into PublicMessengerConfig; agent-only fields (routing) are
 * stripped from the public projection (see getPublicWidgetConfig).
 */
/** Web-widget deployment flags. Shared identity lives in settings.assistant_config. */
export interface AssistantDeploymentConfig {
  enabled?: boolean
  respond?: boolean
}

export interface PublicAssistantConfig extends AssistantDeploymentConfig {
  name: string
  avatarUrl: string | null
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
  /**
   * When true, a visitor cannot reply to a CLOSED conversation from the
   * Messenger — the send is refused instead of reopening the thread (support
   * platform §4.3). Default off (undefined = off), where a reply reopens. Email
   * replies always reopen regardless; this applies to the Messenger only.
   */
  preventRepliesWhenClosed?: boolean
  /** AI-assistant display identity (client-safe). */
  assistant?: AssistantDeploymentConfig
  /**
   * @deprecated Migration-only. The canonical office-hours schedule now lives in
   * the `settings.metadata` bag (see settings.office-hours.ts). This field only
   * types the released stored config that the read-time fallback converts; no
   * code writes it and it is not projected into the public widget config.
   */
  officeHours?: OfficeHoursConfig
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
  'routing' | 'officeHours' | 'assistant'
> & {
  assistant?: PublicAssistantConfig
}

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

/** Which visitors a Home card is shown to (visitor-vs-user content). */
export type WidgetCardAudience = 'everyone' | 'anonymous' | 'identified'

/** An ordered, admin-configurable card on the widget Home surface. */
export interface WidgetHomeCard {
  id: string
  type: WidgetHomeCardType
  /** Hidden without being removed (defaults to shown). */
  enabled?: boolean
  /** Show only to a segment of visitors — everyone (default), signed-out
   *  visitors, or identified users. Lets a "Sign in" card target anonymous
   *  visitors and account content target identified ones. */
  audience?: WidgetCardAudience
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

/** Abstract pattern presets for the widget Home hero backdrop. */
export type WidgetHeroPatternId = 'dots' | 'grid' | 'mesh' | 'waves'

/** Customisation for the aggregated Home surface (greeting, hero, quick links). */
export interface WidgetHomeConfig {
  /** Greeting heading; supports a `{name}` placeholder (e.g. "Hi {name} 👋"). */
  greeting?: string
  /** Subtitle under the greeting (e.g. "How can we help?"). */
  subtitle?: string
  /** Home hero treatment: plain background, a color gradient (brand-tinted
   *  unless `gradient` sets custom colors), an abstract pattern preset, or an
   *  uploaded image. Fills the whole Home panel behind the header and cards,
   *  dissolving into the background toward the bottom. */
  headerStyle?: 'plain' | 'gradient' | 'image' | 'pattern'
  /** Custom hero colors (hex, e.g. "#7c3aed"). Applies to 'gradient' and
   *  'pattern' styles; absent/empty = tinted from the theme's primary. */
  gradient?: { from?: string; to?: string }
  /** Which abstract pattern the 'pattern' style shows. Default 'mesh'. */
  pattern?: WidgetHeroPatternId
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
  /** Proactive one-line greeting shown in a bubble beside the closed launcher
   *  (e.g. "Need a hand?"). Empty/unset shows no bubble. Dismissible per browser
   *  session; clicking it opens the widget. */
  launcherGreeting?: string
  /** Which tabs to show in the widget bottom bar */
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    /** Messenger (the "Messages" tab). */
    messenger?: boolean
    /** Support tickets (the "Tickets" tab). */
    tickets?: boolean
    /** Show the aggregated Home tab (defaults to on; only appears with 2+ sections) */
    home?: boolean
  }
  /** Messenger settings, stored under `messenger`. */
  messenger?: MessengerConfig
  /** Home surface customisation (greeting, hero style, quick-link cards). */
  home?: WidgetHomeConfig
  /** Per-locale overrides of the customer-facing copy (welcome/offline message,
   *  home greeting/subtitle). The base fields are the fallback. */
  translations?: WidgetTranslations
}

/**
 * Public subset of widget config — safe to include in TenantSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Pick<
  WidgetConfig,
  'enabled' | 'defaultBoard' | 'position' | 'tabs' | 'home' | 'launcherGreeting' | 'translations'
> & {
  /** Always true: identify requires a backend-signed ssoToken (GH issue #300). */
  hmacRequired?: boolean
  /** Client-safe messenger config (no agent-only fields like routing). */
  messenger?: PublicMessengerConfig
}

export const DEFAULT_MESSENGER_CONFIG: MessengerConfig = {
  enabled: false,
  welcomeMessage: 'Hi! 👋 How can we help you today?',
  offlineMessage: "We're away right now. Leave a message and we'll get back to you by email.",
  // AI-first by default: conversations open fronted by the assistant identity.
  // Admins can rename or disable it under Settings → AI & Automation. `respond`
  // defaults off — identity is on, in-process answering is opt-in.
  assistant: { enabled: true, respond: false },
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
  launcherGreeting?: string
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    messenger?: boolean
    tickets?: boolean
    home?: boolean
  }
  messenger?: Partial<MessengerConfig>
  home?: WidgetHomeConfig
  translations?: WidgetTranslations
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
  /**
   * "Allow search engines to index" toggle (domains/languages §1). Off adds
   * a noindex meta tag to every /hc page, excludes /hc from the sitemap, and
   * disallows /hc in robots.txt.
   */
  indexable: boolean
}

export const DEFAULT_HELP_CENTER_SEO_CONFIG: HelpCenterSeoConfig = {
  metaDescription: '',
  sitemapEnabled: true,
  structuredDataEnabled: true,
  ogImageKey: null,
  indexable: true,
}

/**
 * A custom domain for the help center (domains/languages §1). Self-host
 * reality: OSS does not automate TLS or DNS. The operator CNAMEs the domain
 * to their instance and terminates TLS in their own proxy; this config only
 * tracks the domain name and whether the "Verify" check has ever passed
 * (DNS resolves + the instance answers on it).
 *
 * `verifiedAt: null` -- unverified, no behaviour change (the default host
 * keeps serving /hc as normal). `verifiedAt: <ISO>` -- the default host's
 * /hc/* pages 301 to this domain (full coverage) and canonical/OG URLs use
 * it instead of BASE_URL.
 */
export interface HelpCenterDomainConfig {
  /** Canonical lowercase ASCII FQDN, or null when unset. */
  domain: string | null
  /** ISO-8601 UTC. Null = unverified (or verification broke and was cleared). */
  verifiedAt: string | null
}

export const DEFAULT_HELP_CENTER_DOMAIN_CONFIG: HelpCenterDomainConfig = {
  domain: null,
  verifiedAt: null,
}

/**
 * Help center configuration
 * Controls the inline knowledge base behavior (always public, always inside the portal)
 */
/** Per-locale UI chrome for an ADDITIONAL (non-default) help-center locale. */
export interface HelpCenterLocaleChromeStrings {
  homepageTitle: string
  homepageDescription: string
  searchPlaceholder: string
}

export const DEFAULT_HELP_CENTER_LOCALE_CHROME: HelpCenterLocaleChromeStrings = {
  homepageTitle: '',
  homepageDescription: '',
  searchPlaceholder: '',
}

/**
 * Help center locales (domains/languages §2). The default locale is
 * unprefixed (`/hc/...`) and keeps using the top-level `homepageTitle`/
 * `homepageDescription` above -- it needs no chrome entry of its own.
 * Additional locales are URL-prefixed (`/hc/{locale}/...`) and require a
 * `chrome` entry with a non-empty `homepageTitle` before they can be
 * enabled (Intercom-style validation): a locale with no title strings has
 * nothing to show on its own homepage.
 */
export interface HelpCenterLocalesConfig {
  /** Always the app's DEFAULT_LOCALE; not independently configurable in v1. */
  default: string
  /** Enabled additional locale codes, each a SupportedLocale. */
  additional: string[]
  /** Chrome strings for additional locales, keyed by locale code. */
  chrome: Record<string, HelpCenterLocaleChromeStrings>
}

export const DEFAULT_HELP_CENTER_LOCALES_CONFIG: HelpCenterLocalesConfig = {
  default: 'en',
  additional: [],
  chrome: {},
}

/**
 * Auto-translate (domains/languages §H3, fast-follow). Off by default. When
 * on, publishing a base-locale article queues a per-additional-locale
 * translation job through the BYOK AI client; results are written as DRAFT
 * translations only (an editor must publish them). `protectedTerms` are
 * glossary entries (product name, technical terms) the translation prompt
 * is instructed never to translate.
 */
export interface HelpCenterAutoTranslateConfig {
  enabled: boolean
  protectedTerms: string[]
}

export const DEFAULT_HELP_CENTER_AUTO_TRANSLATE_CONFIG: HelpCenterAutoTranslateConfig = {
  enabled: false,
  protectedTerms: [],
}

export interface HelpCenterConfig {
  enabled: boolean
  homepageTitle: string
  homepageDescription: string
  domain: HelpCenterDomainConfig
  locales: HelpCenterLocalesConfig
  autoTranslate: HelpCenterAutoTranslateConfig
  seo: HelpCenterSeoConfig
}

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  enabled: false,
  homepageTitle: 'How can we help?',
  homepageDescription: 'Search our knowledge base or browse by category',
  domain: DEFAULT_HELP_CENTER_DOMAIN_CONFIG,
  locales: DEFAULT_HELP_CENTER_LOCALES_CONFIG,
  autoTranslate: DEFAULT_HELP_CENTER_AUTO_TRANSLATE_CONFIG,
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
  /** Replaced wholesale (items is an ordered array — never merged). */
  nav?: PortalNavConfig
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
  /** Changelog audience/nav/collaboration/email settings */
  changelogConfig: ChangelogSettings
  /** Status page enablement/visibility/email settings */
  statusConfig: StatusSettings
  /** Public widget config (no secret, safe for client) */
  publicWidgetConfig: PublicWidgetConfig
  /** Product availability and experimental feature flags */
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
// Product and Feature Flags
// =============================================================================

/**
 * Workspace product availability and experimental/in-development features.
 * Product flags default on; optional AI and analytics flags default off.
 */
export interface FeatureFlags {
  /** Feedback boards, posts, voting, and roadmaps */
  feedback: boolean
  /** Product changelog */
  changelog: boolean
  /** Help center knowledge base */
  helpCenter: boolean
  /** AI answers with citations on help-center search surfaces */
  helpCenterAiAnswers: boolean
  /** Support inbox: messenger widget channel + unified admin inbox. Also
   *  covers conversation niceties like external link preview cards. */
  supportInbox: boolean
  /** Support tickets: durable, trackable requests portal alongside conversations */
  supportTickets: boolean
  /** Cookieless visitor + pageview analytics (portal and widget) */
  visitorAnalytics: boolean
  /** Durable first-party device id: connects visitors to leads and users
   *  across visits. Subordinate to `visitorAnalytics` — rendered as a nested
   *  sub-toggle in Labs and only effective when analytics is on. */
  visitorDeviceTracking: boolean
  /** Teammate-facing AI in the inbox: Copilot's private Q&A tab,
   *  two-way conversation translation, and AI classification of
   *  ai_detect-enabled conversation attributes. Each capability keeps its
   *  own finer-grained controls (copilot.use permission, per-conversation
   *  translation, per-attribute opt-in). */
  inboxAi: boolean
  /** What the AI assistant may DO: built-in actions such as closing
   *  conversations and creating tickets. Every action has per-action
   *  controls and approvals. */
  assistantTools: boolean
  /** Status page: public/private/segment-scoped service status with incidents,
   *  maintenance windows, uptime history, and subscriber notifications. */
  statusPage: boolean
}

/**
 * Pre-consolidation flag keys that may still appear in stored
 * `settings.feature_flags` JSON. Each maps to the umbrella flag that
 * absorbed it; `resolveFeatureFlags` ORs them in at read time so tenants
 * who enabled a feature before the consolidation keep it without a
 * migration. `linkPreviews` is absent deliberately: it folded into
 * `supportInbox` (default on), and a stored `linkPreviews: true` must not
 * force a disabled inbox back on.
 */
export const LEGACY_FLAG_MAP: Record<string, keyof FeatureFlags> = {
  assistantCopilot: 'inboxAi',
  inboxTranslation: 'inboxAi',
  aiAttributeDetection: 'inboxAi',
  assistantActions: 'assistantTools',
}

/**
 * Resolve stored feature-flags JSON to the current FeatureFlags shape:
 * defaults for missing keys, stored values for known keys, and legacy
 * (pre-consolidation) keys coalesced into their umbrella flag — an explicit
 * stored value for the umbrella key wins over any legacy keys. Unknown keys
 * are dropped, so the first write after an upgrade persists a clean shape.
 */
export function resolveFeatureFlags(storedJson: string | null | undefined): FeatureFlags {
  const stored: Record<string, unknown> = storedJson ? JSON.parse(storedJson) : {}
  const flags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS }
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>) {
    if (typeof stored[key] === 'boolean') flags[key] = stored[key]
  }
  for (const [legacyKey, umbrella] of Object.entries(LEGACY_FLAG_MAP)) {
    if (stored[umbrella] === undefined && stored[legacyKey] === true) flags[umbrella] = true
  }
  return flags
}

/**
 * Defaults for a multi-product workspace.
 *
 * Product surfaces (Support, Help Center, Status, tickets, link previews)
 * default **on** so nav and admin shells show the full platform without a
 * Labs treasure-hunt. AI capabilities and anything that collects visitor
 * data stay **off** until an operator opts in — they need a configured
 * model and/or a privacy review (visitor analytics ships before its consent
 * gate, so it must not start collecting on upgrade).
 *
 * Existing tenants with an explicit `featureFlags` JSON row keep stored
 * values; only missing keys and null rows pick up these defaults (merged in
 * settings.service).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  // Products — on
  feedback: true,
  changelog: true,
  helpCenter: true,
  supportInbox: true,
  supportTickets: true,
  statusPage: true,
  // AI / privacy-sensitive — opt-in
  helpCenterAiAnswers: false,
  visitorAnalytics: false,
  visitorDeviceTracking: false,
  inboxAi: false,
  assistantTools: false,
}

/**
 * Feature flag metadata for the admin UI
 */
export const FEATURE_FLAG_REGISTRY: Record<
  keyof FeatureFlags,
  { label: string; description: string }
> = {
  feedback: {
    label: 'Feedback & Roadmaps',
    description: 'Collect ideas, votes, and comments from customers and share what comes next.',
  },
  changelog: {
    label: 'Changelog',
    description: 'Publish product updates and keep customers informed about what you ship.',
  },
  helpCenter: {
    label: 'Help Center',
    description: 'Publish a searchable help center so customers can find answers on their own.',
  },
  helpCenterAiAnswers: {
    label: 'Help Center AI Answers',
    description:
      'Let customers ask a question and get an instant AI answer with citations, built only from your published help articles. Requires an AI model to be configured.',
  },
  supportInbox: {
    label: 'Conversations',
    description:
      'Let visitors start a conversation with Messenger from the widget; messages land in a shared inbox your team works from. Includes link preview cards for external links shared in conversations.',
  },
  supportTickets: {
    label: 'Support Tickets',
    description:
      'Give customers a Tickets portal for durable, trackable support requests alongside conversations.',
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
  inboxAi: {
    label: 'Inbox AI',
    description:
      'AI for your team inside the inbox: a private Copilot tab for asking questions about a conversation, two-way message translation, and automatic classification of conversation attributes you opt in. Requires an AI model to be configured; each capability has its own controls.',
  },
  assistantTools: {
    label: 'Assistant actions',
    description:
      'Let the AI assistant take actions such as closing conversations or creating tickets. Actions have per-action controls and approvals.',
  },
  statusPage: {
    label: 'Status page',
    description:
      'Publish a status page on your portal with live component status, incidents, scheduled maintenance, uptime history, and subscriber notifications.',
  },
}

export type ProductId = 'feedback' | 'support' | 'helpCenter' | 'changelog' | 'status'

export interface ProductDefinition {
  id: ProductId
  label: string
  description: string
  featureFlags: readonly (keyof FeatureFlags)[]
  adminPath:
    | '/admin/feedback'
    | '/admin/inbox'
    | '/admin/help-center'
    | '/admin/changelog'
    | '/admin/status'
}

/**
 * Workspace products shown on Settings > General. Support retains its two
 * persisted capability flags for compatibility, but the UI changes them as a
 * single product so workspaces no longer need to coordinate two Labs toggles.
 */
export const PRODUCT_DEFINITIONS = [
  {
    id: 'feedback',
    label: 'Feedback & Roadmaps',
    description: 'Collect ideas, votes, and comments from customers and share your roadmap.',
    featureFlags: ['feedback'],
    adminPath: '/admin/feedback',
  },
  {
    id: 'support',
    label: 'Support',
    description: 'Manage customer conversations and tickets together in a shared inbox.',
    featureFlags: ['supportInbox', 'supportTickets'],
    adminPath: '/admin/inbox',
  },
  {
    id: 'helpCenter',
    label: 'Help Center',
    description: 'Publish searchable help articles so customers can find answers themselves.',
    featureFlags: ['helpCenter'],
    adminPath: '/admin/help-center',
  },
  {
    id: 'changelog',
    label: 'Changelog',
    description: 'Publish product updates and keep customers informed about what you ship.',
    featureFlags: ['changelog'],
    adminPath: '/admin/changelog',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Share live service status, incidents, maintenance, and uptime history.',
    featureFlags: ['statusPage'],
    adminPath: '/admin/status',
  },
] as const satisfies readonly ProductDefinition[]

function getProductDefinition(productId: ProductId): ProductDefinition {
  return PRODUCT_DEFINITIONS.find((product) => product.id === productId)!
}

/** A product is available when any of its backing capabilities is enabled. */
export function isProductEnabled(
  flags: Partial<FeatureFlags> | null | undefined,
  productId: ProductId
): boolean {
  const definition = getProductDefinition(productId)
  const effectiveFlags = flags ?? DEFAULT_FEATURE_FLAGS
  return definition.featureFlags.some((key) => effectiveFlags[key] === true)
}

/** Build the partial feature-flag update represented by one product switch. */
export function getProductFlagUpdate(
  productId: ProductId,
  enabled: boolean
): Partial<FeatureFlags> {
  const definition = getProductDefinition(productId)
  return Object.fromEntries(
    definition.featureFlags.map((key) => [key, enabled])
  ) as Partial<FeatureFlags>
}

/** First usable product destination, with a non-product fallback for all-off workspaces. */
export function getFirstEnabledAdminProductPath(
  flags: Partial<FeatureFlags> | null | undefined
): ProductDefinition['adminPath'] | '/admin/analytics' {
  return (
    PRODUCT_DEFINITIONS.find((product) => isProductEnabled(flags, product.id))?.adminPath ??
    '/admin/analytics'
  )
}

/**
 * Labs page layout: experimental flags grouped into sections, each rendered as
 * a card with a heading + high-level description. Product flags are surfaced
 * on General instead; a coverage test pins every flag to exactly one page. A
 * sub-flag renders indented beneath its parent row and is only toggleable while
 * the parent is on.
 */
export interface LabSectionRow {
  key: keyof FeatureFlags
  subFlags?: Array<keyof FeatureFlags>
}

export const LAB_SECTIONS: Array<{
  title: string
  description: string
  flags: LabSectionRow[]
}> = [
  {
    title: 'AI',
    description:
      'Optional AI capabilities. Require a configured model; off by default until you opt in.',
    flags: [{ key: 'helpCenterAiAnswers' }, { key: 'inboxAi' }, { key: 'assistantTools' }],
  },
  {
    title: 'Privacy-sensitive',
    description:
      'Analytics about who visits your portal and widget. Review your privacy policy before enabling.',
    flags: [{ key: 'visitorAnalytics', subFlags: ['visitorDeviceTracking'] }],
  },
]
