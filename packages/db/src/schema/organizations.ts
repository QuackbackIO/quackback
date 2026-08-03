/**
 * Organizations & contacts schema — Phase 2 of the ticketing rollout.
 *
 *   - `organizations` represents a customer company (B2B context).
 *   - `contacts` represents a human at that company (or an unaffiliated
 *     individual). One contact belongs to at most one organization (FK).
 *   - `contact_user_links` links a contact to one or more portal `user`
 *     accounts (N:M) so an authenticated portal user can be recognised as
 *     "the same person" as the email-based contact on a ticket.
 *
 * No tickets reference these tables yet; they are populated independently
 * via the REST API and CRM-style admin UI, then consumed by Phase 3 ticket
 * intake helpers (`findOrCreateByEmail`, `findOrCreateByDomain`).
 */
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal, user } from './auth'

/**
 * JSON value used by the `metadata` jsonb columns. Constrained (rather than
 * `Record<string, unknown>`) so server functions returning `Organization` /
 * `Contact` rows pass TanStack Start's serialisability check.
 */
export type OrgJsonValue =
  | string
  | number
  | boolean
  | null
  | OrgJsonValue[]
  | { [key: string]: OrgJsonValue }
export type OrgMetadata = { [key: string]: OrgJsonValue }

export const organizations = pgTable(
  'organizations',
  {
    id: typeIdWithDefault('org')('id').primaryKey(),
    name: text('name').notNull(),
    /** Lowercased apex domain (e.g. "acme.com"). Partial-unique when not null. */
    domain: text('domain'),
    /** External CRM identifier (HubSpot/Salesforce/etc.). Partial-unique when not null. */
    externalId: text('external_id'),
    website: text('website'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<OrgMetadata>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('organizations_domain_idx')
      .on(t.domain)
      .where(sql`domain IS NOT NULL`),
    uniqueIndex('organizations_external_id_idx')
      .on(t.externalId)
      .where(sql`external_id IS NOT NULL`),
    index('organizations_name_idx').on(t.name),
    index('organizations_archived_at_idx').on(t.archivedAt),
  ]
)

export const contacts = pgTable(
  'contacts',
  {
    id: typeIdWithDefault('contact')('id').primaryKey(),
    name: text('name'),
    /** Lowercased email. Partial-unique when not null AND not archived. */
    email: text('email'),
    phone: text('phone'),
    title: text('title'),
    externalId: text('external_id'),
    organizationId: typeIdColumnNullable('org')('organization_id').references(
      () => organizations.id,
      { onDelete: 'set null' }
    ),
    avatarUrl: text('avatar_url'),
    metadata: jsonb('metadata').$type<OrgMetadata>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contacts_email_idx')
      .on(t.email)
      .where(sql`email IS NOT NULL AND archived_at IS NULL`),
    uniqueIndex('contacts_external_id_idx')
      .on(t.externalId)
      .where(sql`external_id IS NOT NULL`),
    index('contacts_organization_idx').on(t.organizationId),
    index('contacts_archived_at_idx').on(t.archivedAt),
  ]
)

/**
 * contact_user_links — N:M between contacts and portal users.
 *
 * A portal user signing in with email "[email protected]" can be linked to the
 * contact created earlier from an inbound ticket. Multiple portal accounts
 * may map to the same contact (e.g. SSO migration); a single portal user may
 * be associated with multiple contacts (rare, but allowed).
 */
export const contactUserLinks = pgTable(
  'contact_user_links',
  {
    id: typeIdWithDefault('cu_link')('id').primaryKey(),
    contactId: typeIdColumn('contact')('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    userId: typeIdColumn('user')('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Principal who created the link (NULL = system / migration). */
    linkedByPrincipalId: typeIdColumnNullable('principal')('linked_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('contact_user_links_contact_user_idx').on(t.contactId, t.userId),
    index('contact_user_links_user_idx').on(t.userId),
  ]
)

export const organizationsRelations = relations(organizations, ({ many }) => ({
  contacts: many(contacts),
}))

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  userLinks: many(contactUserLinks),
}))

export const contactUserLinksRelations = relations(contactUserLinks, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactUserLinks.contactId],
    references: [contacts.id],
  }),
  user: one(user, {
    fields: [contactUserLinks.userId],
    references: [user.id],
  }),
  linkedByPrincipal: one(principal, {
    fields: [contactUserLinks.linkedByPrincipalId],
    references: [principal.id],
  }),
}))
