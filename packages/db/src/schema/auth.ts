/**
 * Better-auth schema for Drizzle ORM integration.
 *
 * Uses TypeID format (uuid storage with type-prefixed strings in app layer).
 * This matches the pattern used by application tables (posts, boards, etc.).
 *
 * @see https://www.better-auth.com/docs/adapters/drizzle
 */
import { relations } from 'drizzle-orm'
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { apiKeys } from './api-keys'
import { integrations } from './integrations'

/**
 * User table - User identities for the application
 */
export const user = pgTable(
  'user',
  {
    id: typeIdWithDefault('user')('id').primaryKey(),
    name: text('name').notNull(),
    /** Nullable — external users (Slack, etc.) may not have a real email */
    email: text('email'),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    // Profile image - S3 storage key (e.g., "avatars/2026/02/abc123-avatar.png")
    imageKey: text('image_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // General user metadata (JSON)
    metadata: text('metadata'),
    // BCP-47 locale claim from OIDC (e.g. "en", "en-US"); NULL for
    // sign-up paths that don't carry one (magic-link, password).
    locale: text('locale'),
    // ISO-3166-1 alpha-2 country code captured from CDN-injected
    // headers (CF-IPCountry, X-Vercel-IP-Country, Fly-Client-IP-Country,
    // X-Country-Code) on session creation. NULL when no header is
    // present — local dev or deployments without a geo-aware proxy.
    country: text('country'),
    // Stable external identity for widget-identified visitors: the verified JWT
    // `sub` (the host app's durable user id). Set ONLY on the verified ssoToken
    // identify path so a visitor is recognized on a new device even after an
    // email change. Null for team accounts and unverified identifies.
    externalId: text('external_id'),
    // Anonymous user flag (Better Auth anonymous plugin)
    isAnonymous: boolean('is_anonymous').default(false).notNull(),
    // Better-Auth twoFactor plugin — flips true once the user verifies
    // their TOTP secret. Read by the sign-in flow to decide whether to
    // emit the 2FA challenge response (`twoFactorRedirect: true`).
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  },
  (table) => [
    // Email is unique when present (partial index — nulls are allowed)
    uniqueIndex('user_email_idx')
      .on(table.email)
      .where(sql`email IS NOT NULL`),
    // Functional index on LOWER(email) — backs the case-insensitive
    // lookups in recovery-codes-consume.ts, segment.evaluation.ts, and
    // routes/api/widget/identify.ts. Without it those queries seq-scan.
    index('user_email_lower_idx')
      .on(sql`LOWER(${table.email})`)
      .where(sql`email IS NOT NULL`),
    // One account per external subject — backs the verified-identify lookup and
    // stops two users claiming the same host-app `sub`. Partial: nulls allowed.
    uniqueIndex('user_external_id_idx')
      .on(table.externalId)
      .where(sql`external_id IS NOT NULL`),
    // Partial b-tree on country / locale — both are referenced by the
    // dynamic-segment evaluator (IN / ILIKE predicates) and the column
    // is sparse, so partial indexes keep the on-disk footprint small.
    index('user_country_idx')
      .on(table.country)
      .where(sql`country IS NOT NULL`),
    index('user_locale_idx')
      .on(table.locale)
      .where(sql`locale IS NOT NULL`),
  ]
)

/**
 * Two-factor enrolments managed by Better-Auth's twoFactor plugin.
 *
 * One row per user once TOTP is enabled. `secret` is the symmetric-
 * encrypted TOTP shared secret; `backupCodes` is a packed string of
 * one-time recovery codes (also encrypted). `verified` flips false
 * during the brief window between `/two-factor/enable` and the
 * subsequent `/two-factor/verify-totp`; the default `true` matches
 * Better-Auth's expectation for newly-inserted rows.
 */
export const twoFactor = pgTable('two_factor', {
  id: typeIdWithDefault('two_factor')('id').primaryKey(),
  userId: typeIdColumn('user')('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  verified: boolean('verified').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable(
  'session',
  {
    // Better-Auth generates session IDs internally, so we use text instead of TypeID
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('session_userId_idx').on(table.userId),
    // Composite index drives the `max(session.created_at) GROUP BY
    // user_id` aggregate used by the team-list "last sign-in" column
    // — without it, the planner does an index scan on `session_userId_idx`
    // but still reads every row's created_at. With this, the planner
    // can do an index-only scan and stop at the first row per group.
    index('session_userId_createdAt_idx').on(table.userId, table.createdAt.desc()),
    // Range-scan support for the active-users analytics query, which counts
    // distinct users whose session.updated_at falls within the period.
    index('session_updatedAt_idx').on(table.updatedAt),
  ]
)

export const account = pgTable(
  'account',
  {
    id: typeIdWithDefault('account')('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('account_userId_idx').on(table.userId),
    // Backs the segment evaluator's signup_source lookup:
    // `SELECT provider_id FROM account WHERE user_id = $1 ORDER BY
    // created_at ASC LIMIT 1`. Without the composite the ORDER BY
    // requires a sort even though the WHERE is index-satisfied.
    index('account_userId_createdAt_idx').on(table.userId, table.createdAt),
  ]
)

export const verification = pgTable(
  'verification',
  {
    // Better-Auth generates verification IDs internally, so we use text instead of TypeID
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

/**
 * One-time token table - Used by better-auth oneTimeToken plugin
 * for secure cross-domain session transfer after workspace provisioning
 */
export const oneTimeToken = pgTable('one_time_token', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  userId: typeIdColumn('user')('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Settings table - Application settings and branding configuration
 *
 * For single-tenant OSS deployments, this table has one row containing
 * all application settings. The id, name, and slug are kept for display
 * and branding purposes.
 */
export const settings = pgTable('settings', {
  id: typeIdWithDefault('workspace')('id').primaryKey(), // Keep workspace prefix for TypeID compatibility
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Logo - S3 storage key (e.g., "logos/2026/02/abc123-logo.png")
  logoKey: text('logo_key'),
  // Favicon - S3 storage key
  faviconKey: text('favicon_key'),
  // Header logo - S3 storage key
  headerLogoKey: text('header_logo_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  metadata: text('metadata'),
  /**
   * Team authentication configuration (JSON)
   * Structure: { oauth: { google, github, microsoft }, ssoRequired, openSignup }
   */
  authConfig: text('auth_config'),
  /**
   * Portal configuration (JSON)
   * Structure: { oauth: { google, github }, features: { submissions, comments, voting } }
   */
  portalConfig: text('portal_config'),
  /**
   * Branding/theme configuration (JSON)
   * Structure: { preset?, light?: ThemeColors, dark?: ThemeColors }
   */
  brandingConfig: text('branding_config'),
  /**
   * Custom CSS for portal customization
   * Injected after theme styles in the portal layout
   */
  customCss: text('custom_css'),
  /**
   * Developer configuration (JSON)
   * Structure: { mcpEnabled: boolean }
   */
  developerConfig: text('developer_config'),
  /**
   * Header display mode - how the brand appears in portal navigation
   * - 'logo_and_name': Square logo + name (default)
   * - 'logo_only': Just the square logo
   * - 'custom_logo': Use headerLogoUrl (horizontal wordmark)
   */
  headerDisplayMode: text('header_display_mode').default('logo_and_name'),
  /**
   * Custom display name for the header (used in 'logo_and_name' mode)
   * Falls back to settings.name when not set
   */
  headerDisplayName: text('header_display_name'),
  /**
   * Setup/onboarding state tracking (JSON). See {@link SetupState} in
   * packages/db/src/types.ts for the source-of-truth shape.
   */
  setupState: text('setup_state'),
  /**
   * Widget configuration (JSON)
   * Structure: { enabled, defaultBoard?, position?, buttonText?, identifyVerification? }
   */
  widgetConfig: text('widget_config'),
  /**
   * Widget HMAC verification secret (separate column — NOT in JSON config)
   * Format: 'wgt_' + 64 hex chars
   */
  widgetSecret: text('widget_secret'),
  /** Feature flags for experimental features (JSON) */
  featureFlags: text('feature_flags'),
  /**
   * Help center configuration (JSON)
   * Structure: { enabled, homepageTitle, homepageDescription, seo }
   */
  helpCenterConfig: text('help_center_config'),
  /**
   * Optional per-workspace tier limits (JSON-encoded TierLimits).
   * Written via /api/v1/admin/tier-limits (capability scope
   * `internal:tier-limits`) by operators who want to impose caps.
   * Null/absent means defaults (everything unlimited, all features
   * on).
   */
  tierLimits: text('tier_limits'),
  /**
   * JSON array of dot-paths whose values are managed by the
   * declarative config file (`/etc/quackback/config.yaml`). When a
   * path is in this list, the in-app UI mutator for that field
   * returns 403 and the form control is rendered disabled. The list
   * is rebuilt from scratch on every file reconcile, so removing a
   * key from the file unlocks the UI on the next reconcile tick.
   *
   * Example: ["workspace.name", "tierLimits", "features.helpCenter"].
   *
   * Whole-block lock: a managed path with no dots locks the entire
   * subtree (e.g. "tierLimits" locks "tierLimits.maxBoards" too).
   */
  managedFieldPaths: jsonb('managed_field_paths').$type<string[]>().notNull().default([]),
  /**
   * Workspace state — written by the config-file reconciler when
   * spec.state is set. With no config file present, the column keeps
   * its `'active'` default. The middleware in
   * `lib/server/middleware/suspension-guard.ts` returns 402 / 410 for
   * non-`active` workspaces, and the root route redirects HTML hits to
   * `/suspended`.
   */
  state: text('state').$type<'active' | 'suspended' | 'deleting'>().notNull().default('active'),
  /**
   * Monotonic version bumped on every auth-instance-affecting write
   * (authConfig, ssoOidc, oauth toggles, platform credentials, tier
   * limits, config-file reconciler). Pods compare their cached auth
   * instance's recorded version against this value on each request and
   * call resetAuth() on mismatch — defense-in-depth backstop for the
   * Redis pub/sub invalidation channel `auth:config-invalidate`.
   *
   * Mutated only via atomic SQL `auth_config_version + 1` to avoid
   * lost-update on concurrent writes.
   */
  authConfigVersion: integer('auth_config_version').notNull().default(0),
})

/**
 * Verified SSO domains for the workspace.
 *
 * Each row pairs an email domain with the workspace's OIDC IdP:
 *  - `verified_at` null = pending DNS verification.
 *  - `verified_at` non-null = routes emails at this domain to SSO.
 *  - `enforced=true` = hard-binds emails at this domain to SSO (blocks
 *    password / magic-link / non-SSO OAuth).
 *
 * Single-tenant per deployment so no settings_id FK is needed. The
 * UNIQUE constraint on `name` keeps each domain on one row regardless
 * of pending/verified state.
 */
export const ssoVerifiedDomain = pgTable(
  'sso_verified_domain',
  {
    id: typeIdWithDefault('domain')('id').primaryKey(),
    /** Canonical lowercase ASCII FQDN — `normalizeDomain` output. */
    name: text('name').notNull(),
    /** Random base32-ish token; intentionally public via DNS TXT. */
    verificationToken: text('verification_token').notNull(),
    /** Null until DNS lookup confirms the TXT record. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** When true: emails at this domain are hard-bound to SSO. */
    enforced: boolean('enforced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: uniqueIndex('sso_verified_domain_name_unique').on(t.name),
  })
)

/**
 * Metadata for service principals (discriminated union by kind)
 */
export type ServiceMetadata =
  | { kind: 'integration'; integrationType: string; integrationId?: string }
  | { kind: 'api_key'; apiKeyId: string }

/**
 * Principal table - Unified identity for all actor types
 *
 * All actors have a principal record with a role:
 * - 'admin': Full administrative access, can manage settings and team
 * - 'member': Team member access, can manage feedback
 * - 'user': Portal user access only, can vote/comment on public portal
 *
 * Principal types:
 * - 'user': Human user with a userId pointing to the user table
 * - 'service': Integration or API key actor (userId is null)
 *
 * The role determines access level: admin/member can access /admin dashboard,
 * while 'user' role can only interact with the public portal.
 */
export const principal = pgTable(
  'principal',
  {
    id: typeIdWithDefault('principal')('id').primaryKey(),
    // Nullable: null for service principals (API keys, integrations)
    userId: typeIdColumnNullable('user')('user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    // Unified roles: 'admin' | 'member' | 'user'
    // 'user' role = portal users (public portal access only, no admin dashboard)
    role: text('role').default('member').notNull(),
    // Principal type: 'user' (human), 'anonymous' (unidentified visitor), or 'service' (integration/API key)
    type: text('type').default('user').notNull(),
    // Display name — always populated (humans synced from user.name, service principals set on creation)
    displayName: text('display_name'),
    // Avatar URL — OAuth/external avatar URLs (humans synced from user.image)
    avatarUrl: text('avatar_url'),
    // Avatar storage key — S3 key for uploaded avatars (humans synced from user.imageKey)
    avatarKey: text('avatar_key'),
    // Metadata for service principals (discriminated union by kind)
    serviceMetadata: jsonb('service_metadata').$type<ServiceMetadata | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /**
     * Last time this principal completed an SSO sign-in (Better-Auth
     * generic-OAuth callback with providerId='sso' creating a new
     * session). Read by the SSO-enforcement bootstrap guard to refuse
     * enabling enforcement without a recent SSO sign-in window — stops
     * an admin who only signed in via magic-link from locking themselves
     * out. Null = never signed in via SSO. Written by the
     * /oauth2/callback/:providerId hooks.after middleware.
     */
    lastSsoSignInAt: timestamp('last_sso_sign_in_at', { withTimezone: true }),
    // Contact email for an anonymous visitor (captured in live chat) so an
    // offline reply can reach them across conversations. Agent-only — the
    // principal stays anonymous; never exposed to the visitor.
    contactEmail: text('contact_email'),
    // Manual agent availability override: 'online' (default — route chats to me)
    // vs 'away' (connected but opted out of routing). The presence TTL handles
    // auto-offline; this is the explicit opt-out, persisted across sessions.
    chatAvailability: text('chat_availability', { enum: ['online', 'away'] })
      .notNull()
      .default('online'),
  },
  (table) => [
    // Ensure one principal record per human user (partial index excludes service principals)
    uniqueIndex('principal_user_idx')
      .on(table.userId)
      .where(sql`user_id IS NOT NULL`),
    // Lookups by contact email (only the rows that have one).
    index('principal_contact_email_idx')
      .on(table.contactEmail)
      .where(sql`contact_email IS NOT NULL`),
    // Index for user listings filtered by role
    index('principal_role_idx').on(table.role),
    // Index for filtering by principal type
    index('principal_type_idx').on(table.type),
    // Composite index for date-filtered user listings (e.g. portal users by join date)
    index('principal_role_created_at_idx').on(table.role, table.createdAt),
  ]
)

export const invitation = pgTable(
  'invitation',
  {
    id: typeIdWithDefault('invite')('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    /**
     * Discriminates team invitations from portal-access invitations.
     * 'team'   — sent via the team/members settings page (original behaviour).
     * 'portal' — sent via the portal-access settings page to grant a specific
     *            person access to a private portal.
     *
     * Every query against this table MUST filter on `kind` so that a portal
     * invite for an email never leaks into the team-invite UI and vice versa.
     */
    kind: text('kind').$type<'team' | 'portal'>().notNull().default('team'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    inviterId: typeIdColumn('user')('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_email_idx').on(table.email),
    // Index for duplicate invitation checks (legacy — kept for backward compatibility)
    index('invitation_email_status_idx').on(table.email, table.status),
    // Composite index for kind-discriminated lookup paths
    index('invitation_email_kind_status_idx').on(table.email, table.kind, table.status),
    // Backs the daily invite-sweep: `kind IN (...) AND status='pending'
    // AND expires_at < now()`. The existing email-leading indexes can't
    // serve this query — sweep would seq-scan as the table grows.
    // Partial-on-pending keeps the index footprint small (terminal
    // rows dominate over time).
    index('invitation_pending_expires_idx')
      .on(table.kind, table.expiresAt)
      .where(sql`status = 'pending'`),
  ]
)

/**
 * JWKS table - JSON Web Key Sets for JWT signing/verification
 * Used by the jwt() plugin for token signing keys
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})

/**
 * OAuth Client table - Registered OAuth 2.1 clients (e.g., Claude Code, MCP clients)
 * Created via dynamic client registration or admin management
 */
export const oauthClient = pgTable('oauth_client', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  disabled: boolean('disabled').default(false),
  skipConsent: boolean('skip_consent'),
  enableEndSession: boolean('enable_end_session'),
  scopes: text('scopes').array(),
  userId: typeIdColumn('user')('user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  // Client metadata
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: text('contacts').array(),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  // OAuth configuration
  redirectUris: text('redirect_uris').array().notNull(),
  postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  grantTypes: text('grant_types').array(),
  responseTypes: text('response_types').array(),
  public: boolean('public'),
  type: text('type'),
  requirePKCE: boolean('require_pkce'),
  referenceId: text('reference_id'),
  metadata: jsonb('metadata'),
})

/**
 * OAuth Refresh Token table - Long-lived tokens for token refresh
 */
export const oauthRefreshToken = pgTable('oauth_refresh_token', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: typeIdColumn('user')('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  revoked: timestamp('revoked', { withTimezone: true }),
  authTime: timestamp('auth_time', { withTimezone: true }),
  scopes: text('scopes').array().notNull(),
})

/**
 * OAuth Access Token table - Short-lived tokens for API access
 */
export const oauthAccessToken = pgTable('oauth_access_token', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: typeIdColumn('user')('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  scopes: text('scopes').array().notNull(),
})

/**
 * OAuth Consent table - Records of user consent for OAuth client scopes
 */
export const oauthConsent = pgTable('oauth_consent', {
  id: text('id').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  userId: typeIdColumn('user')('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  scopes: text('scopes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

// Relations for Drizzle relational queries (enables experimental joins)
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  principals: many(principal),
  invitations: many(invitation),
  oauthClients: many(oauthClient),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
}))

export const sessionRelations = relations(session, ({ one, many }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

// Settings is a singleton table in single-tenant mode, no relations needed
export const settingsRelations = relations(settings, () => ({}))

export const principalRelations = relations(principal, ({ one, many }) => ({
  user: one(user, {
    fields: [principal.userId],
    references: [user.id],
  }),
  createdApiKeys: many(apiKeys, { relationName: 'apiKeyCreator' }),
  apiKey: many(apiKeys, { relationName: 'apiKeyPrincipal' }),
  connectedIntegrations: many(integrations, { relationName: 'integrationConnector' }),
  integration: many(integrations, { relationName: 'integrationPrincipal' }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))

export const oauthClientRelations = relations(oauthClient, ({ one, many }) => ({
  user: one(user, {
    fields: [oauthClient.userId],
    references: [user.id],
  }),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
}))

export const oauthRefreshTokenRelations = relations(oauthRefreshToken, ({ one, many }) => ({
  oauthClient: one(oauthClient, {
    fields: [oauthRefreshToken.clientId],
    references: [oauthClient.clientId],
  }),
  session: one(session, {
    fields: [oauthRefreshToken.sessionId],
    references: [session.id],
  }),
  user: one(user, {
    fields: [oauthRefreshToken.userId],
    references: [user.id],
  }),
  oauthAccessTokens: many(oauthAccessToken),
}))

export const oauthAccessTokenRelations = relations(oauthAccessToken, ({ one }) => ({
  oauthClient: one(oauthClient, {
    fields: [oauthAccessToken.clientId],
    references: [oauthClient.clientId],
  }),
  session: one(session, {
    fields: [oauthAccessToken.sessionId],
    references: [session.id],
  }),
  user: one(user, {
    fields: [oauthAccessToken.userId],
    references: [user.id],
  }),
  oauthRefreshToken: one(oauthRefreshToken, {
    fields: [oauthAccessToken.refreshId],
    references: [oauthRefreshToken.id],
  }),
}))

export const oauthConsentRelations = relations(oauthConsent, ({ one }) => ({
  oauthClient: one(oauthClient, {
    fields: [oauthConsent.clientId],
    references: [oauthClient.clientId],
  }),
  user: one(user, {
    fields: [oauthConsent.userId],
    references: [user.id],
  }),
}))

/**
 * Widget origin session marker table.
 *
 * Records sessions that were created via the widget OTT handoff route
 * (`/auth/widget-handoff?ott=...`). The portal access evaluator requires
 * a row here before granting the `widget` reason — prevents any
 * self-registered portal user from sneaking in via that grant branch.
 *
 * PK on session_id is the lookup key (one row per session at most).
 * Index on user_id supports cleanup of orphaned rows when a user's
 * sessions expire.
 */
export const widgetOriginSession = pgTable(
  'widget_origin_session',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id').notNull(),
    markedAt: timestamp('marked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('widget_origin_session_user_id_idx').on(table.userId)]
)

/**
 * Widget identification provenance table.
 *
 * Records, for each session minted by `/api/widget/identify`, whether
 * the identity claim was HMAC-verified (verified-token path) or
 * unverified (email-capture path). The handoff route reads this to
 * decide whether to insert a `widget_origin_session` marker — only
 * HMAC-verified sessions are allowed to upgrade into the widget
 * portal-access grant.
 *
 * Without this row, the portal gate would only know the workspace's
 * *current* `identifyVerificationEnabled` setting, not whether the
 * specific session was ever HMAC-verified — letting a session created
 * during an unverified window keep portal access after the admin turns
 * verification on, and letting any BA session that minted a generic
 * OTT walk through the handoff.
 *
 * Upsert semantics: re-identifying the same session demotes (or
 * promotes) hmac_verified to reflect the latest identify path. A
 * session that loses HMAC verification on re-identify must lose the
 * trust it carries.
 */
export const widgetIdentifiedSession = pgTable('widget_identified_session', {
  sessionId: text('session_id').primaryKey(),
  hmacVerified: boolean('hmac_verified').notNull(),
  identifiedAt: timestamp('identified_at', { withTimezone: true }).defaultNow().notNull(),
})
