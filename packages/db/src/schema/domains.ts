/**
 * The domains a workspace has added by name on Settings > Domains.
 *
 * A row is the domain itself and its ownership record, nothing more. What the
 * domain is used for (email sending, a custom domain, sign-in) lives in the
 * table that owns each use, joined by name: there are no foreign keys, and a
 * name a use holds needs no row here to be listed.
 *
 * `ownershipToken` is minted for this row and never derived. Only finding it
 * published at `_quackback.<name>` moves the row to `verified`.
 */
import { pgTable, text, timestamp, unique, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

export const DOMAIN_STATUSES = ['pending', 'verified'] as const
export type DomainStatus = (typeof DOMAIN_STATUSES)[number]

export const domains = pgTable(
  'domains',
  {
    id: typeIdWithDefault('workspace_domain')('id').primaryKey(),
    /** Lowercase ASCII (A-label) form of the name. */
    name: text('name').notNull(),
    ownershipToken: text('ownership_token').notNull(),
    status: text('status', { enum: DOMAIN_STATUSES }).notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** When a verified row's record was first found missing. Read by the ownership watch. */
    ownershipMissingSince: timestamp('ownership_missing_since', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('domains_name_unique').on(table.name),
    check('domains_status_check', sql`${table.status} IN ('pending', 'verified')`),
  ]
)

export type Domain = typeof domains.$inferSelect
