/**
 * User tags schema
 *
 * Lightweight admin-applied labels for portal people, mirroring the post-tags
 * pattern: a tags table (unique name, color, soft delete) plus a join table
 * keyed (principal_id, tag_id) with both FKs cascading. Unlike segments,
 * tags carry no membership rules — assignment is always explicit.
 */
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const userTags = pgTable(
  'user_tags',
  {
    id: typeIdWithDefault('user_tag')('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color').default('#6b7280').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('user_tags_deleted_at_idx').on(table.deletedAt)]
)

export const userTagAssignments = pgTable(
  'user_tag_assignments',
  {
    principalId: typeIdColumn('principal')('principal_id').notNull(),
    tagId: typeIdColumn('user_tag')('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'user_tag_assignments_principal_id_fk',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_tag_assignments_tag_id_fk',
      columns: [table.tagId],
      foreignColumns: [userTags.id],
    }).onDelete('cascade'),
    uniqueIndex('user_tag_assignments_pk').on(table.principalId, table.tagId),
    index('user_tag_assignments_tag_id_idx').on(table.tagId),
  ]
)

export const userTagsRelations = relations(userTags, ({ many }) => ({
  assignments: many(userTagAssignments),
}))

export const userTagAssignmentsRelations = relations(userTagAssignments, ({ one }) => ({
  tag: one(userTags, {
    fields: [userTagAssignments.tagId],
    references: [userTags.id],
  }),
  principal: one(principal, {
    fields: [userTagAssignments.principalId],
    references: [principal.id],
  }),
}))
