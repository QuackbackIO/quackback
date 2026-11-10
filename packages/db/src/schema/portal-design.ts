/**
 * Portal designs: each site's design document as a draft and as numbered,
 * immutable published revisions (see 0310_portal_designs.sql). A null
 * `siteId` is the workspace's default site.
 *
 * `publishedRevisionId` and `draftBaseRevisionId` point into
 * portal_design_revisions without a foreign key, because the two tables
 * reference each other; the design service keeps them consistent. A publish
 * refuses when the draft's base is no longer the published revision.
 */
import {
  pgTable,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
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
    // Moves on with every draft save and is never reset; part of the draft's revision.
    draftVersion: integer('draft_version').notNull().default(0),
    draftUpdatedByPrincipalId: typeIdColumnNullable('principal')(
      'draft_updated_by_principal_id'
    ).references(() => principal.id, { onDelete: 'set null' }),
    // Who made each change the draft holds, by its dotted path; see draft-authors.ts.
    draftAuthors: jsonb('draft_authors').$type<Record<string, string>>(),
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

/**
 * Links that show a design not yet live to someone without admin access (see
 * 0312_portal_design_preview_links.sql). Each holds the design as it was when
 * the link was made, so later edits never reach it, and only the SHA-256 hash
 * of its token.
 */
export const portalDesignPreviewLinks = pgTable(
  'portal_design_preview_links',
  {
    id: typeIdWithDefault('portal_design_preview')('id').primaryKey(),
    designId: typeIdColumn('portal_design')('design_id')
      .notNull()
      .references(() => portalDesigns.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    document: jsonb('document').$type<unknown>().notNull(),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // The creator's foreign key has a short name: the default one is longer than
  // Postgres keeps, and the truncated name would read back as drift.
  (table) => [
    foreignKey({
      name: 'portal_design_preview_links_created_by_fk',
      columns: [table.createdByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    uniqueIndex('portal_design_preview_links_token_hash_idx').on(table.tokenHash),
    index('portal_design_preview_links_design_idx').on(table.designId, table.expiresAt),
  ]
)

/** What a saved design is: a named checkpoint of the draft, or a look to apply again. */
export type PortalDesignSavedKind = 'checkpoint' | 'look'

/**
 * Designs a workspace keeps without publishing them (see
 * 0314_portal_design_saved.sql): named checkpoints of the draft, and looks
 * to apply again. Each holds its document as it was when saved.
 */
export const portalDesignSaved = pgTable(
  'portal_design_saved',
  {
    id: typeIdWithDefault('portal_design_saved')('id').primaryKey(),
    designId: typeIdColumn('portal_design')('design_id')
      .notNull()
      .references(() => portalDesigns.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PortalDesignSavedKind>().notNull(),
    name: text('name').notNull(),
    document: jsonb('document').$type<unknown>().notNull(),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('portal_design_saved_design_kind_idx').on(table.designId, table.kind, table.createdAt),
    check('portal_design_saved_kind_check', sql`${table.kind} IN ('checkpoint', 'look')`),
  ]
)
