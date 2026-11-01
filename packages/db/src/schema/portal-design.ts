/**
 * Portal designs: each site's design document as a draft and as numbered,
 * immutable published revisions (see 0305_portal_designs.sql). A null
 * `siteId` is the workspace's default site.
 *
 * `publishedRevisionId` and `draftBaseRevisionId` point into
 * portal_design_revisions without a foreign key, because the two tables
 * reference each other; the design service keeps them consistent. A publish
 * refuses when the draft's base is no longer the published revision.
 */
import { pgTable, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdColumn, typeIdColumnNullable, typeIdWithDefault } from '@quackback/ids/drizzle'
import { principal } from './auth'

/** Where a published revision came from. */
export type PortalDesignSource =
  'appearance' | 'ai' | 'api' | 'mcp' | 'import' | 'conversion' | 'restore'

export const portalDesigns = pgTable(
  'portal_designs',
  {
    id: typeIdWithDefault('portal_design')('id').primaryKey(),
    siteId: uuid('site_id'),
    publishedRevisionId: typeIdColumnNullable('portal_design_revision')('published_revision_id'),
    // The unpublished design document, or null when there is no draft.
    draft: jsonb('draft').$type<unknown>(),
    draftBaseRevisionId: typeIdColumnNullable('portal_design_revision')('draft_base_revision_id'),
    draftUpdatedAt: timestamp('draft_updated_at', { withTimezone: true }),
    draftUpdatedByPrincipalId: typeIdColumnNullable('principal')(
      'draft_updated_by_principal_id'
    ).references(() => principal.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('portal_designs_site_idx').on(
      sql`(COALESCE(${table.siteId}, '00000000-0000-0000-0000-000000000000'::uuid))`
    ),
  ]
)

export const portalDesignRevisions = pgTable(
  'portal_design_revisions',
  {
    id: typeIdWithDefault('portal_design_revision')('id').primaryKey(),
    designId: typeIdColumn('portal_design')('design_id')
      .notNull()
      .references(() => portalDesigns.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    // The published design document; never edited.
    document: jsonb('document').$type<unknown>().notNull(),
    source: text('source').$type<PortalDesignSource>().notNull(),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('portal_design_revisions_design_number_idx').on(table.designId, table.number),
  ]
)
