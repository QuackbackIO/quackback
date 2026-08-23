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
   * existing workspaces pre-migration aren't suddenly locked out.
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
 * of any stored config. Pre-upgrade workspaces whose `authConfig.oauth`
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
  /**
   * `true` because that is what a workspace that never answered the question
   * has always DONE, not because open sign-ups are the friendlier choice.
   *
   * The setting bound nothing on any server path until `auth/signup-policy.ts`
   * started enforcing it, so every workspace accepted new accounts regardless
   * of what this reported. Two cohorts read their value from here rather than
   * from a stored one: a config-file-provisioned workspace, whose `settings`
   * row is inserted with no `authConfig` column at all, and any row written
   * before this key existed. Defaulting them closed would not enforce a policy
   * anyone set — it would invent one, apply it retroactively, and shut the
   * public portal of every provisioned workspace the moment its owner arrived.
   *
   * `false` is honoured everywhere it is stored. Where it comes FROM is worth
   * being exact about, because it is narrower than it looks: the onboarding
   * wizard writes this key on workspace creation and always writes `true`, and
   * nothing else writes it at all — no admin control sends it, and the
   * declarative config file's `auth` block is a deprecated key the reconciler
   * ignores. So on the team's side this default is, in practice, the value.
   *
   * The public portal's answer is the one an administrator can actually change,
   * through the signup toggle on the portal access settings; see
   * {@link PortalConfig.openSignup}.
   */
  openSignup: true,
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
 * Workspace-wide post-approval policy. Author-type hold (`requireApproval`)
 * can be overridden per board; content holds (`holdImages` / `holdLinks`)
 * are workspace-wide only.
 */
export interface ModerationDefault {
  requireApproval: 'none' | 'anonymous' | 'authenticated' | 'all'
  /** Hold posts and comments that contain an image. Default false. */
  holdImages?: boolean
  /** Hold posts and comments that contain an external link. Default false. */
  holdLinks?: boolean
}

/**
 * Welcome message shown above the post list on the portal index.
 * Body is sanitized TipTap JSON — same shape as post / help-center
 * content, sanitized via `sanitizeTiptapContent` on every write.
 *
 * Default empty (hidden). Renders only when `body` has visible content.
 * Legacy stored `{ enabled, title, body }` is repaired on read: enabled
 * + a non-empty title folds the title into a heading node; disabled
 * drafts resolve to an empty body.
 */
export interface PortalWelcomeCard {
  /** Sanitized TipTap JSON doc. */
  body: TiptapContent
}

/** Empty TipTap doc used as the default / hidden welcome message. */
export const EMPTY_WELCOME_BODY: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

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
  'feedback' | 'roadmap' | 'changelog' | 'help' | 'support' | 'status' | 'link'

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
  /**
   * May a member of the public open an account on the PORTAL?
   *
   * The public portal's own answer to the question {@link AuthConfig.openSignup}
   * answers for the team, and the two are routinely different: a workspace that
   * takes feedback from anyone while keeping the team invitation-only says
   * `true` here and `false` there. Provisioned workspaces are seeded with
   * exactly that pair.
   *
   * **Optional, and deliberately absent from {@link DEFAULT_PORTAL_CONFIG}.**
   * Absent means "this portal has no answer of its own", and the policy then
   * falls back to the workspace-wide {@link AuthConfig.openSignup}. Giving this
   * a default would make that absence unobservable and sever the fallback, so a
   * workspace carrying only the workspace-wide answer would stop obeying it.
   *
   * Written by `updatePortalConfigFn` — the signup toggle on the portal access
   * settings — and by nothing else. The first save writes an explicit value and
   * the fallback stops applying from then on, which is the intended meaning of
   * an administrator answering the question directly.
   *
   * Read through `signupOpenFor` in `auth/signup-policy.ts`; nothing else
   * should compare this field directly.
   */
  openSignup?: boolean
  /** Welcome message on the portal index. Optional — absent / empty body = hidden. */
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
 * Portal Support tab configuration. Gated by `isPortalSupportSurfaceEnabled`
 * (`supportTickets` OR `supportInbox` plus this toggle); independent of the
 * widget Messages tab.
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
    body: EMPTY_WELCOME_BODY,
  },
  moderationDefault: { requireApproval: 'none', holdImages: false, holdLinks: false },
  access: { visibility: 'public', allowedDomains: [], widgetSignIn: false, allowedSegmentIds: [] },
  support: { enabled: false },
}

/**
 * Fail-closed read of the workspace anonymous-interaction ceiling from a raw
 * (un-merged) `settings.portalConfig`. Only an explicitly-enabled flag permits
 * anonymous vote / comment / submit; a missing flag DENIES — the security gate
 * must not inherit `getPortalConfig`'s permissive merged default. Existing
 * workspaces carry an explicit value from migration 0084, and the per-board tier
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
  /**
   * @deprecated Ignored at read time. Messenger is on when the `supportInbox`
   * flag is on; widget visibility is `tabs.messenger`. Still written by the
   * widget-activation path so stored JSON stays consistent with older readers.
   */
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
   * replies always reopen regardless; this applies to the Messenger only
   * (`reopenOnReply === 'configurable'` on the channel descriptor).
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
  /**
   * @deprecated Migration-only. Canonical routing now lives in the
   * `settings.metadata` bag (`conversationRouting`). This field types the
   * released stored config that the read-time fallback still honours.
   */
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
  'feedback' | 'new_conversation' | 'article_search' | 'latest_updates' | 'link'

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
  /** Text label on the launcher button (e.g. "Chat with us"). Empty/unset
   *  keeps the icon-only circular button. */
  launcherLabel?: string
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
  /** Per-locale overrides of the customer-facing copy (welcome/offline message,
   *  home greeting/subtitle). The base fields are the fallback. */
  translations?: WidgetTranslations
}

/**
 * Public subset of widget config — safe to include in WorkspaceSettings / bootstrap data
 * Does NOT include identifyVerification (admin-only concern)
 */
export type PublicWidgetConfig = Omit<
  Pick<
    WidgetConfig,
    | 'enabled'
    | 'defaultBoard'
    | 'position'
    | 'tabs'
    | 'home'
    | 'launcherGreeting'
    | 'launcherLabel'
    | 'translations'
  >,
  'tabs'
> & {
  /** Always true: identify requires a backend-signed ssoToken (GH issue #300). */
  hmacRequired?: boolean
  /** Client-safe messenger config (no agent-only fields like routing). */
  messenger?: PublicMessengerConfig
  tabs?: NonNullable<WidgetConfig['tabs']> & {
    /**
     * Computed from the `supportTickets` flag — not a stored tab. Ticket
     * pairs surface through Messages; this bit still drives the requester's
     * own-tickets list in the widget.
     */
    tickets?: boolean
  }
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
  launcherLabel?: string
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    messenger?: boolean
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
 * enabled: a locale with no title strings has
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

/** An admin-configured link rendered in the portal header on help center pages. */
export interface HelpCenterHeaderLink {
  label: string
  url: string
}

/** Most header links the help center nav will render; the admin editor enforces the same cap. */
export const HELP_CENTER_HEADER_LINKS_MAX = 3

export interface HelpCenterConfig {
  /**
   * @deprecated Ignored at read time. Help Center is public when the
   * `helpCenter` product flag is on; widget visibility is `tabs.help`.
   */
  enabled: boolean
  homepageTitle: string
  homepageDescription: string
  /** Custom links shown beside the built-in nav on help center pages only. */
  headerLinks: HelpCenterHeaderLink[]
  domain: HelpCenterDomainConfig
  locales: HelpCenterLocalesConfig
  autoTranslate: HelpCenterAutoTranslateConfig
  seo: HelpCenterSeoConfig
}

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  enabled: false,
  homepageTitle: 'How can we help?',
  homepageDescription: 'Search our knowledge base or browse by category',
  headerLinks: [],
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
  /** The portal's own signup answer; see {@link PortalConfig.openSignup}. */
  openSignup?: boolean
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
   * The portal's RESOLVED signup answer — `portalConfig.openSignup` when it has
   * one, the workspace-wide answer when it does not. Resolved on the server,
   * through the same `signupOpenFor` the gate uses, so the sign-in form and the
   * gate can never disagree about whether a stranger may open an account.
   */
  openSignup: boolean
  /**
   * Public OIDC sign-in buttons from the identity_provider table. Each
   * `id` is a provider's `registrationId` (drives
   * `signIn.oauth2({ providerId })`); `name` is its display label. Only
   * button-eligible, registered providers appear — routed-only providers
   * (verified domain + showButton:false) are omitted.
   */
  oidcProviders?: { id: string; name: string }[]
  /** Welcome message on the portal index. Absent / empty body = nothing rendered. */
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
  /**
   * @deprecated Unread. Social share resolves to the workspace logo
   * (`resolvePortalOgImageUrl`); the stored `portal_og_image_key` column is
   * left in place but no longer populated or read.
   */
  ogImageUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

// =============================================================================
// Workspace Settings (consolidated settings object)
// =============================================================================

/**
 * Consolidated workspace settings, parsed from the database settings row.
 * This interface is client-safe (no DB types) and can be imported from the barrel.
 */
export interface WorkspaceSettings {
  /** Raw settings record from database (opaque on client, typed on server) */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
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
  /** Status page enablement/visibility/email settings */
  statusConfig: StatusSettings
  /** Public widget config (no secret, safe for client) */
  publicWidgetConfig: PublicWidgetConfig
  /** Product availability flags */
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
 * Workspace product availability.
 * Core products (Feedback & Roadmaps, Changelog) default on. Support, Help
 * Center, and Status default off until an operator or onboarding goal turns
 * them on.
 */
export interface FeatureFlags {
  /** Feedback boards, posts, voting, and roadmaps */
  feedback: boolean
  /** Product changelog */
  changelog: boolean
  /** Help center knowledge base */
  helpCenter: boolean
  /** Support inbox: messenger widget channel + unified admin inbox. Also
   *  covers conversation niceties like external link preview cards. */
  supportInbox: boolean
  /** Support tickets: durable, trackable requests portal alongside conversations */
  supportTickets: boolean
  /** Status page: public/private/segment-scoped service status with incidents,
   *  maintenance windows, uptime history, and subscriber notifications. */
  statusPage: boolean
}

/**
 * Resolve stored feature-flags JSON to the current FeatureFlags shape:
 * defaults for missing keys, stored values for known keys. Unknown keys
 * (including retired Inbox AI / Connectors / Skills flags) are dropped, so
 * the first write after an upgrade persists a clean shape.
 */
export function resolveFeatureFlags(storedJson: string | null | undefined): FeatureFlags {
  const stored: Record<string, unknown> = storedJson ? JSON.parse(storedJson) : {}
  const flags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS }
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>) {
    if (typeof stored[key] === 'boolean') flags[key] = stored[key]
  }
  // The public portal homepage is the feedback board, so this one is never off,
  // whatever a workspace stored while the switch could still be moved. Read-time
  // repair rather than a migration: it corrects the workspaces that are already
  // wrong, not only the ones upgrading, and the next write persists it.
  flags.feedback = true
  return flags
}

/**
 * Defaults for a new workspace.
 *
 * Feedback & Roadmaps plus Changelog match the historical core product.
 * Support, Help Center, and Status stay off until Settings → General or an
 * onboarding goal turns them on.
 *
 * Existing workspaces with an explicit `featureFlags` JSON row keep stored
 * values. A one-time SQL stamp wrote today's previous all-on object onto
 * null rows before this default flipped, so already-running installs do
 * not lose surfaces. Only missing keys and new null rows pick up these
 * defaults (merged in settings.service).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  feedback: true,
  changelog: true,
  helpCenter: false,
  supportInbox: false,
  supportTickets: false,
  statusPage: false,
}

/** Onboarding outcomes that may turn extra products on. Kept local so this
 *  file stays free of the db package. */
export type FeatureFlagUseCase =
  'product_feedback' | 'customer_support' | 'help_center' | 'internal'

/** Flags to persist for a new workspace, or to merge on (never off) when
 *  the operator picks a goal that needs a module. */
export function featureFlagsForUseCase(useCase?: FeatureFlagUseCase | null): FeatureFlags {
  const flags = { ...DEFAULT_FEATURE_FLAGS }
  if (useCase === 'customer_support') {
    flags.supportInbox = true
    flags.supportTickets = true
  } else if (useCase === 'help_center') {
    flags.helpCenter = true
  }
  return flags
}

/** Turn on the modules a goal needs without turning anything else off. */
export function enableFlagsForUseCase(
  current: FeatureFlags,
  useCase?: FeatureFlagUseCase | null
): FeatureFlags {
  const needed = featureFlagsForUseCase(useCase)
  return {
    ...current,
    supportInbox: current.supportInbox || needed.supportInbox,
    supportTickets: current.supportTickets || needed.supportTickets,
    helpCenter: current.helpCenter || needed.helpCenter,
  }
}

export type ProductId = 'feedback' | 'support' | 'helpCenter' | 'changelog' | 'status'

export interface ProductDefinition {
  id: ProductId
  label: string
  description: string
  featureFlags: readonly (keyof FeatureFlags)[]
  adminPath:
    '/admin/feedback' | '/admin/inbox' | '/admin/help-center' | '/admin/changelog' | '/admin/status'
}

/**
 * Workspace products shown on Settings > General. Support retains two
 * persisted capability keys for compatibility; the UI changes them as one
 * product.
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
    description:
      'Publish a status page with live service status, incidents, maintenance, and uptime history.',
    featureFlags: ['statusPage'],
    adminPath: '/admin/status',
  },
] as const satisfies readonly ProductDefinition[]

/** Product labels that this flag change newly turned on. Additive diffs only. */
export function newlyEnabledProductLabels(before: FeatureFlags, after: FeatureFlags): string[] {
  return PRODUCT_DEFINITIONS.filter((product) =>
    product.featureFlags.some((flag) => before[flag] !== true && after[flag] === true)
  ).map((product) => product.label)
}

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
