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
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'

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
      return value as Buffer
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
  // Logo stored as blob with MIME type
  logoBlob: bytea('logo_blob'),
  logoType: text('logo_type'), // MIME type: image/jpeg, image/png, etc.
  // Favicon stored as blob
  faviconBlob: bytea('favicon_blob'),
  faviconType: text('favicon_type'), // MIME type: image/x-icon, image/png, etc.
  // Header logo stored as blob (horizontal wordmark/lockup)
  headerLogoBlob: bytea('header_logo_blob'),
  headerLogoType: text('header_logo_type'), // MIME type: image/png, image/jpeg, etc.
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
 * Member table - Unified membership for all user types
 *
 * All users have a member record with a role:
 * - 'admin': Full administrative access, can manage settings and team
 * - 'member': Team member access, can manage feedback
 * - 'user': Portal user access only, can vote/comment on public portal
 *
 * The role determines access level: admin/member can access /admin dashboard,
 * while 'user' role can only interact with the public portal.
 */
export const member = pgTable(
  'member',
  {
    id: typeIdWithDefault('member')('id').primaryKey(),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Unified roles: 'admin' | 'member' | 'user'
    // 'user' role = portal users (public portal access only, no admin dashboard)
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Ensure one member record per user (also serves as lookup index)
    uniqueIndex('member_user_idx').on(table.userId),
    // Index for user listings filtered by role
    index('member_role_idx').on(table.role),
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

// Relations for Drizzle relational queries (enables experimental joins)
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
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

// Settings is a singleton table in single-tenant mode, no relations needed
export const settingsRelations = relations(settings, () => ({}))

export const memberRelations = relations(member, ({ one }) => ({
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))
