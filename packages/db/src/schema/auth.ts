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
  customType,
} from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'

// Custom type for PostgreSQL bytea (binary data)
const bytea = customType<{ data: Buffer | null; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: Buffer | null): Buffer | null {
    return value
  },
  fromDriver(value: unknown): Buffer | null {
    if (value === null || value === undefined) {
      return null
    }
    if (Buffer.isBuffer(value)) {
      return value
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value)
    }
    // Handle hex string format from postgres.js (e.g., '\xDEADBEEF')
    if (typeof value === 'string') {
      if (value.startsWith('\\x')) {
        return Buffer.from(value.slice(2), 'hex')
      }
      // Empty string means no data
      if (value === '') {
        return null
      }
    }
    // For any other unexpected format, return null rather than crashing
    console.warn('Unexpected bytea format from database:', typeof value)
    return null
  },
})

/**
 * User table - Workspace-scoped user identities
 *
 * Each user belongs to exactly one workspace. The same email can exist
 * in multiple workspaces as separate user records with separate credentials.
 *
 * This enables true multi-tenant isolation where each workspace has
 * completely independent authentication.
 */
export const user = pgTable(
  'user',
  {
    id: typeIdWithDefault('user')('id').primaryKey(),
    // Workspace this user belongs to - enables workspace-scoped email uniqueness
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    // Profile image stored as blob (alternative to URL in 'image' field)
    imageBlob: bytea('image_blob'),
    imageType: text('image_type'), // MIME type: image/jpeg, image/png, etc.
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // General user metadata (JSON)
    metadata: text('metadata'),
  },
  (table) => [
    // Email is unique per workspace (not globally)
    uniqueIndex('user_email_workspace_idx').on(table.workspaceId, table.email),
    index('user_workspace_id_idx').on(table.workspaceId),
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
    activeWorkspaceId: typeIdColumnNullable('workspace')('active_workspace_id'),
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

export const workspace = pgTable('workspace', {
  id: typeIdWithDefault('workspace')('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  // Logo stored as blob (alternative to URL in 'logo' field)
  logoBlob: bytea('logo_blob'),
  logoType: text('logo_type'), // MIME type: image/jpeg, image/png, etc.
  // Favicon stored as blob
  faviconBlob: bytea('favicon_blob'),
  faviconType: text('favicon_type'), // MIME type: image/x-icon, image/png, etc.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  metadata: text('metadata'),
  /**
   * Team authentication configuration (JSON)
   * @see AuthConfig in workspace.types.ts
   * Structure: { oauth: { google, github, microsoft }, ssoRequired, openSignup }
   */
  authConfig: text('auth_config'),
  /**
   * Portal configuration (JSON)
   * @see PortalConfig in workspace.types.ts
   * Structure: { oauth: { google, github }, features: { publicView, submissions, comments, voting } }
   */
  portalConfig: text('portal_config'),
  /**
   * Branding/theme configuration (JSON)
   * @see BrandingConfig in workspace.types.ts
   * Structure: { preset?, light?: ThemeColors, dark?: ThemeColors }
   */
  brandingConfig: text('branding_config'),
  /**
   * Custom CSS for portal customization
   * Injected after theme styles in the portal layout
   */
  customCss: text('custom_css'),
  /**
   * Header logo blob (horizontal wordmark/lockup for custom header branding)
   * Used when headerDisplayMode is 'custom_logo'
   */
  headerLogoBlob: bytea('header_logo_blob'),
  headerLogoType: text('header_logo_type'), // MIME type: image/png, image/jpeg, image/svg+xml, etc.
  /**
   * Header display mode - how the brand appears in portal navigation
   * - 'logo_and_name': Square logo + workspace name (default)
   * - 'logo_only': Just the square logo
   * - 'custom_logo': Use headerLogoBlob (horizontal wordmark)
   */
  headerDisplayMode: text('header_display_mode').default('logo_and_name'),
  /**
   * Custom display name for the header (used in 'logo_and_name' mode)
   * Falls back to workspace.name when not set
   */
  headerDisplayName: text('header_display_name'),
})

/**
 * Member table - Unified membership for all user types
 *
 * All users (team members and portal users) have a member record with a role:
 * - 'owner': Full administrative access, can manage billing and delete workspace
 * - 'admin': Administrative access, can manage team and settings
 * - 'member': Team member access, can manage feedback
 * - 'user': Portal user access only, can vote/comment on public portal
 *
 * The role determines access level: owner/admin/member can access /admin dashboard,
 * while 'user' role can only interact with the public portal.
 */
export const member = pgTable(
  'member',
  {
    id: typeIdWithDefault('member')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Unified roles: 'owner' | 'admin' | 'member' | 'user'
    // 'user' role = portal users (public portal access only, no admin dashboard)
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('member_workspaceId_idx').on(table.workspaceId),
    index('member_userId_idx').on(table.userId),
    // Ensure one member record per user per workspace
    uniqueIndex('member_user_workspace_idx').on(table.userId, table.workspaceId),
    // Composite index for portal user listings filtered by role
    index('member_workspace_role_idx').on(table.workspaceId, table.role),
  ]
)

export const invitation = pgTable(
  'invitation',
  {
    id: typeIdWithDefault('invite')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
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
    index('invitation_workspaceId_idx').on(table.workspaceId),
    index('invitation_email_idx').on(table.email),
    // Composite index for duplicate invitation checks
    index('invitation_workspace_email_status_idx').on(table.workspaceId, table.email, table.status),
  ]
)

/**
 * SSO Provider table for Better-Auth SSO plugin
 *
 * Stores SAML and OIDC provider configurations per workspace.
 * Used by the SSO plugin to authenticate users via enterprise identity providers.
 *
 * @see https://www.better-auth.com/docs/plugins/sso
 */
export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: typeIdWithDefault('sso_provider')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    // Issuer identifier (e.g., "https://accounts.google.com" or SAML entityId)
    issuer: text('issuer').notNull(),
    // Domain for email-based provider routing (e.g., "acme.com")
    domain: text('domain').notNull(),
    // Unique provider identifier used in login URLs
    providerId: text('provider_id').notNull().unique(),
    // OIDC configuration (JSON): { clientId, clientSecret, discoveryUrl, ... }
    oidcConfig: text('oidc_config'),
    // SAML configuration (JSON): { ssoUrl, certificate, signRequest, ... }
    samlConfig: text('saml_config'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('sso_provider_workspace_id_idx').on(table.workspaceId),
    // Domain is unique per workspace (not globally) - same domain can be used by different workspaces
    uniqueIndex('sso_provider_workspace_domain_idx').on(table.workspaceId, table.domain),
    // Index for SSO detection by email domain
    index('sso_provider_domain_idx').on(table.domain),
  ]
)

// Relations for Drizzle relational queries (enables experimental joins)
export const userRelations = relations(user, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [user.workspaceId],
    references: [workspace.id],
  }),
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  sessionTransferTokens: many(sessionTransferToken),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const workspaceRelations = relations(workspace, ({ many }) => ({
  users: many(user),
  members: many(member),
  invitations: many(invitation),
  ssoProviders: many(ssoProvider),
  domains: many(workspaceDomain),
}))

export const memberRelations = relations(member, ({ one }) => ({
  workspace: one(workspace, {
    fields: [member.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invitation.workspaceId],
    references: [workspace.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
  workspace: one(workspace, {
    fields: [ssoProvider.workspaceId],
    references: [workspace.id],
  }),
}))

/**
 * Session Transfer Token table for per-subdomain session creation
 *
 * When auth flows happen on the main domain but sessions need to be
 * created on tenant subdomains, this table stores one-time tokens
 * that are exchanged for session cookies on the target subdomain.
 *
 * Used by:
 * - OAuth callbacks (main domain -> subdomain)
 * - Workspace creation (main domain -> new subdomain)
 */
export const sessionTransferToken = pgTable(
  'session_transfer_token',
  {
    id: typeIdWithDefault('transfer_token')('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    targetDomain: text('target_domain').notNull(),
    callbackUrl: text('callback_url').notNull(),
    /** Context for post-login redirect: 'team' -> /admin, 'portal' -> / */
    context: text('context').default('team').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('session_transfer_token_token_idx').on(table.token)]
)

export const sessionTransferTokenRelations = relations(sessionTransferToken, ({ one }) => ({
  user: one(user, {
    fields: [sessionTransferToken.userId],
    references: [user.id],
  }),
}))

/**
 * Workspace Domain table for multi-domain support
 *
 * Each workspace can have multiple domains:
 * - Auto-generated subdomain (e.g., acme.quackback.io)
 * - Custom domains (e.g., feedback.acme.com)
 *
 * The proxy uses this table to resolve which workspace a request belongs to.
 */
export const workspaceDomain = pgTable(
  'workspace_domain',
  {
    id: typeIdWithDefault('domain')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    domainType: text('domain_type').notNull(), // 'subdomain' | 'custom'
    isPrimary: boolean('is_primary').default(false).notNull(),
    verified: boolean('verified').default(true).notNull(),
    verificationToken: text('verification_token'),
    // Cloudflare for SaaS fields (cloud edition only)
    cloudflareHostnameId: text('cloudflare_hostname_id'),
    sslStatus: text('ssl_status'), // CF SSL status: initializing, pending_validation, active, etc.
    ownershipStatus: text('ownership_status'), // CF ownership: pending, active, blocked
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('workspace_domain_workspace_id_idx').on(table.workspaceId),
    // Index for tenant resolution by domain (critical path for every request)
    index('workspace_domain_domain_idx').on(table.domain),
    // Index for Cloudflare webhook lookups by hostname ID
    index('workspace_domain_cf_hostname_id_idx').on(table.cloudflareHostnameId),
  ]
)

export const workspaceDomainRelations = relations(workspaceDomain, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceDomain.workspaceId],
    references: [workspace.id],
  }),
}))
