/**
 * Catalog Database Schema
 *
 * Defines the schema for the catalog database which stores:
 * - Workspace metadata (slug, Neon project ID, migration status)
 * - Domain mappings (subdomains and custom domains)
 * - Verification codes (for email verification during signup)
 *
 * This schema is used by multiple consumers:
 * - resolver.ts: Domain→tenant resolution
 * - domains.service.ts: Domain CRUD operations
 * - get-started.ts: Workspace provisioning
 * - context.ts: URL generation
 *
 * Note: The catalog database is separate from tenant databases.
 * Each tenant has their own isolated database for application data.
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
// Tables
// ============================================

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  neonProjectId: text('neon_project_id'),
  neonRegion: text('neon_region').default('aws-us-east-1'),
  migrationStatus: text('migration_status').default('pending'), // 'pending' | 'in_progress' | 'completed'
})

export const workspaceDomain = pgTable(
  'workspace_domain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    domainType: text('domain_type').notNull(), // 'subdomain' | 'custom'
    isPrimary: boolean('is_primary').default(false).notNull(),
    verified: boolean('verified').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Cloudflare custom domain fields
    verificationToken: text('verification_token'), // HTTP verification token
    cloudflareHostnameId: text('cloudflare_hostname_id'), // Cloudflare custom hostname ID
    sslStatus: text('ssl_status'), // initializing|pending_validation|pending_issuance|pending_deployment|active|expired|deleted
    ownershipStatus: text('ownership_status'), // pending|active|moved|blocked|deleted
  },
  (table) => [
    index('workspace_domain_workspace_id_idx').on(table.workspaceId),
    index('workspace_domain_cf_hostname_id_idx').on(table.cloudflareHostnameId),
  ]
)

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    unique('verification_identifier_unique').on(table.identifier),
  ]
)

// ============================================
// Billing Tables (Cloud Edition)
// ============================================

/**
 * Stripe customer → workspace mapping
 *
 * Enables webhook lookups without tenant context resolution.
 * Created when a workspace initiates checkout or is assigned a Stripe customer.
 */
export const stripeCustomer = pgTable(
  'stripe_customer',
  {
    stripeCustomerId: text('stripe_customer_id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('stripe_customer_workspace_idx').on(table.workspaceId)]
)

/**
 * Subscription table - one per workspace
 *
 * Tracks workspace subscription state, synced from Stripe via webhooks.
 * Free tier workspaces have a subscription record with tier='free' and no stripeSubscriptionId.
 */
export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    tier: text('tier').notNull().default('free'), // free|pro|team|enterprise
    status: text('status').notNull().default('active'), // trialing|active|past_due|canceled|unpaid
    seatsIncluded: integer('seats_included').notNull().default(1),
    seatsAdditional: integer('seats_additional').notNull().default(0),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('subscription_workspace_idx').on(table.workspaceId),
    index('subscription_stripe_customer_idx').on(table.stripeCustomerId),
    unique('subscription_workspace_unique').on(table.workspaceId),
  ]
)

/**
 * Invoice table - multiple per workspace
 *
 * Tracks billing history, synced from Stripe via webhooks.
 * Used to display invoice history in billing settings.
 */
export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
    amountDue: integer('amount_due').notNull(),
    amountPaid: integer('amount_paid').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status').notNull(), // draft|open|paid|void|uncollectible
    invoiceUrl: text('invoice_url'),
    pdfUrl: text('pdf_url'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('invoice_workspace_idx').on(table.workspaceId),
    index('invoice_stripe_invoice_idx').on(table.stripeInvoiceId),
  ]
)

// ============================================
// Relations
// ============================================

export const workspaceRelations = relations(workspace, ({ many, one }) => ({
  domains: many(workspaceDomain),
  subscription: one(subscription),
  invoices: many(invoice),
  stripeCustomer: one(stripeCustomer),
}))

export const workspaceDomainRelations = relations(workspaceDomain, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceDomain.workspaceId],
    references: [workspace.id],
  }),
}))

export const stripeCustomerRelations = relations(stripeCustomer, ({ one }) => ({
  workspace: one(workspace, {
    fields: [stripeCustomer.workspaceId],
    references: [workspace.id],
  }),
}))

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  workspace: one(workspace, {
    fields: [subscription.workspaceId],
    references: [workspace.id],
  }),
}))

export const invoiceRelations = relations(invoice, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invoice.workspaceId],
    references: [workspace.id],
  }),
}))

// ============================================
// Schema Object
// ============================================

/** Catalog database schema for workspace metadata, domains, verification, and billing */
export const catalogSchema = {
  workspace,
  workspaceDomain,
  verification,
  stripeCustomer,
  subscription,
  invoice,
  workspaceRelations,
  workspaceDomainRelations,
  stripeCustomerRelations,
  subscriptionRelations,
  invoiceRelations,
}
