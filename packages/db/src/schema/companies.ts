/**
 * Companies — the B2B company / account object (support platform §4.4).
 *
 * A company groups the people who belong to one customer organization and
 * carries the plan / MRR context agents see inline in the inbox. People link to
 * a company via `principal.company_id` (nullable, soft-owned FK, set null on
 * delete). Tickets gain a `company_id` when the support platform lands.
 */
import { pgTable, text, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const companies = pgTable(
  'companies',
  {
    id: typeIdWithDefault('company')('id').primaryKey(),
    name: text('name').notNull(),
    // Email domain that maps people to this company; case-insensitively unique.
    domain: text('domain'),
    // External CRM identifier for linkage; unique when present.
    externalId: text('external_id'),
    // Free-text plan label (e.g. "Scale") shown in the agent sidebar.
    plan: text('plan'),
    // Monthly recurring revenue in minor units (cents), for sidebar context.
    mrrCents: integer('mrr_cents'),
    // Arbitrary CRM-synced attributes.
    customAttributes: jsonb('custom_attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One company per email domain, case-insensitive (LOWER functional index).
    // Partial so unset domains never collide.
    uniqueIndex('companies_domain_lower_idx')
      .on(sql`LOWER(${table.domain})`)
      .where(sql`"domain" IS NOT NULL`),
    // CRM linkage id, unique when present.
    uniqueIndex('companies_external_id_idx')
      .on(table.externalId)
      .where(sql`"external_id" IS NOT NULL`),
  ]
)

export const companiesRelations = relations(companies, ({ many }) => ({
  people: many(principal),
}))
