import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { conversationMessages } from './conversation'
import type { FilePreviewMeta } from '../types'

/**
 * One row per uploaded file attached (or about to be attached) to a
 * conversation or ticket message.
 *
 * The row is written when the upload finishes, before any message exists, so a
 * file that is never sent has no `messageId` and the retention sweep removes it.
 * `contentType`, `family` and `size` come from the stored bytes; the sender's
 * claim is kept in `declaredType` for display only. Preview data (counts, a
 * thumbnail, the first rows or lines) is filled by the `file-preview` job and
 * copied onto the message attachment, so reading a thread never joins here.
 */
export const files = pgTable(
  'files',
  {
    id: typeIdWithDefault('file')('id').primaryKey(),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    declaredType: text('declared_type'),
    family: text('family').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    /** Where the upload came from: agent | visitor | portal | email | api. */
    source: text('source').notNull(),
    uploadedById: typeIdColumnNullable('principal')('uploaded_by_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    /** The first message the file was attached to. */
    messageId: typeIdColumnNullable('conversation_msg')('message_id').references(
      () => conversationMessages.id,
      { onDelete: 'set null' }
    ),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    /** pending | ready | failed | none (a family with nothing to derive). */
    previewStatus: text('preview_status').notNull().default('pending'),
    meta: jsonb('meta').$type<FilePreviewMeta>().notNull().default({}),
    /** Leading text of the file, for the assistant and search. */
    textExcerpt: text('text_excerpt'),
    /** Viewer opens, so usage by format is measurable. */
    openCount: integer('open_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('files_storage_key_idx').on(table.storageKey),
    index('files_message_id_idx').on(table.messageId),
    index('files_unattached_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.attachedAt} IS NULL AND ${table.deletedAt} IS NULL`),
  ]
)

export type FileRecord = typeof files.$inferSelect
export type NewFileRecord = typeof files.$inferInsert

export const filesRelations = relations(files, ({ one }) => ({
  uploadedBy: one(principal, { fields: [files.uploadedById], references: [principal.id] }),
  message: one(conversationMessages, {
    fields: [files.messageId],
    references: [conversationMessages.id],
  }),
}))
