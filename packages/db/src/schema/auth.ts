/**
 * Better-auth schema for Drizzle ORM integration.
 *
 * Uses TypeID format (uuid storage with type-prefixed strings in app layer).
 * This matches the pattern used by application tables (posts, boards, etc.).
 *
 * @see https://www.better-auth.com/docs/adapters/drizzle
 */
import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'

/**
 * User table - User identities for the application
 */
export const user = pgTable(
  'user',
  {
    id: typeIdWithDefault('user')('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
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
  },
  (table) => [
    // Email is unique globally
    uniqueIndex('user_email_idx').on(table.email),
  ]
)

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
  (table) => [index('session_userId_idx').on(table.userId)]
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
  (table) => [index('account_userId_idx').on(table.userId)]
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
   * Structure: { oauth: { google, github }, features: { publicView, submissions, comments, voting } }
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
   * Setup/onboarding state tracking (JSON)
   * Structure: {
   *   version: number,           // Schema version for migrations
   *   steps: {
   *     core: boolean,           // Core schema setup complete
   *     statuses: boolean,       // Default statuses created
   *     boards: boolean,         // At least one board created or skipped
   *   },
   *   completedAt?: string,      // ISO timestamp when onboarding was fully completed
   *   source: 'cloud' | 'self-hosted'  // How this instance was provisioned
   * }
   */
  setupState: text('setup_state'),
})

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
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Unified roles: 'admin' | 'member' | 'user'
    // 'user' role = portal users (public portal access only, no admin dashboard)
    role: text('role').default('member').notNull(),
    // Principal type: 'user' (human) or 'service' (integration/API key)
    type: text('type').default('user').notNull(),
    // Display name for service principals (humans use user.name)
    displayName: text('display_name'),
    // Metadata for service principals (discriminated union by kind)
    serviceMetadata: jsonb('service_metadata').$type<ServiceMetadata | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Ensure one principal record per user (also serves as lookup index)
    uniqueIndex('principal_user_idx').on(table.userId),
    // Index for user listings filtered by role
    index('principal_role_idx').on(table.role),
    // Index for filtering by principal type
    index('principal_type_idx').on(table.type),
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
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    inviterId: typeIdColumn('user')('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_email_idx').on(table.email),
    // Index for duplicate invitation checks
    index('invitation_email_status_idx').on(table.email, table.status),
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

export const principalRelations = relations(principal, ({ one }) => ({
  user: one(user, {
    fields: [principal.userId],
    references: [user.id],
  }),
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
