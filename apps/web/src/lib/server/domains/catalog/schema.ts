/**
 * Catalog Database Schema (Read-Only View for Quackback)
 *
 * This schema defines the tables quackback needs to query from the catalog database.
 * The catalog database is managed by the website codebase (quackback.io).
 *
 * Tables included:
 * - workspace: Workspace metadata for tenant resolution
 * - workspaceDomain: Domain mappings for routing
 * - subscription: Subscription state for feature gating
 *
 * Tables NOT included (managed exclusively by website):
 * - user, session, account: Website authentication (better-auth)
 * - stripeCustomer, invoice: Billing operations
 * - verification: Website email verification
 *
 * IMPORTANT: This schema must match the website's schema definitions.
 * Source of truth: /home/james/website/src/lib/db/schema/
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================
// Workspace Table
// ============================================

export const workspace = pgTable(
  'workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Owner reference - ties workspace to website user (text ID from better-auth)
    ownerId: text('owner_id'),
    // Keep owner_email for backwards compatibility (existing workspaces)
    ownerEmail: text('owner_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Neon tenant database info
    neonProjectId: text('neon_project_id'),
    neonConnectionString: text('neon_connection_string'), // encrypted
    neonRegion: text('neon_region').default('aws-us-east-1'),
    migrationStatus: text('migration_status').default('pending'), // 'pending' | 'in_progress' | 'completed'
  },
  (table) => [
    unique('workspace_slug_unique').on(table.slug),
    index('workspace_owner_id_idx').on(table.ownerId),
    index('workspace_owner_email_idx').on(table.ownerEmail),
  ]
)

// ============================================
// Workspace Domain Table
// ============================================

export const workspaceDomain = pgTable(
  'workspace_domain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    domainType: text('domain_type').notNull(), // 'subdomain' | 'custom'
    isPrimary: boolean('is_primary').default(false).notNull(),
    verified: boolean('verified').default(true).notNull(),
    verificationToken: text('verification_token'),
    cloudflareHostnameId: text('cloudflare_hostname_id'),
    sslStatus: text('ssl_status'),
    ownershipStatus: text('ownership_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('workspace_domain_domain_unique').on(table.domain),
    index('workspace_domain_workspace_id_idx').on(table.workspaceId),
    index('workspace_domain_domain_idx').on(table.domain),
    index('workspace_domain_cf_hostname_id_idx').on(table.cloudflareHostnameId),
  ]
)

// ============================================
// Subscription Table (for feature gating)
// ============================================

export const subscription = pgTable(
  'subscription',
  {
    id: text('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    tier: text('tier').notNull().default('free'), // 'free' | 'pro' | 'team' | 'enterprise'
    status: text('status').notNull().default('active'), // 'active' | 'canceled' | 'past_due' | 'trialing' | 'unpaid'
    seatsIncluded: integer('seats_included').notNull().default(1),
    seatsAdditional: integer('seats_additional').notNull().default(0),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('subscription_workspace_unique').on(table.workspaceId),
    index('subscription_workspace_idx').on(table.workspaceId),
    index('subscription_stripe_customer_idx').on(table.stripeCustomerId),
  ]
)

// ============================================
// Relations
// ============================================

export const workspaceRelations = relations(workspace, ({ many, one }) => ({
  domains: many(workspaceDomain),
  subscription: one(subscription),
}))

export const workspaceDomainRelations = relations(workspaceDomain, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceDomain.workspaceId],
    references: [workspace.id],
  }),
}))

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  workspace: one(workspace, {
    fields: [subscription.workspaceId],
    references: [workspace.id],
  }),
}))

// ============================================
// Schema Object
// ============================================

/** Catalog database schema for quackback tenant resolution and feature gating */
export const catalogSchema = {
  workspace,
  workspaceDomain,
  subscription,
  workspaceRelations,
  workspaceDomainRelations,
  subscriptionRelations,
}
