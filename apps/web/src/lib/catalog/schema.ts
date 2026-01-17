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

import { pgTable, text, timestamp, boolean, integer, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================
// Tables
// ============================================

export const workspace = pgTable('workspace', {
  id: text('id').primaryKey(),
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
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
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
    id: text('id').primaryKey(),
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
// Relations
// ============================================

export const workspaceRelations = relations(workspace, ({ many }) => ({
  domains: many(workspaceDomain),
}))

export const workspaceDomainRelations = relations(workspaceDomain, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceDomain.workspaceId],
    references: [workspace.id],
  }),
}))

// ============================================
// Schema Object
// ============================================

/** Catalog database schema for workspace metadata, domains, and verification */
export const catalogSchema = {
  workspace,
  workspaceDomain,
  verification,
  workspaceRelations,
  workspaceDomainRelations,
}
