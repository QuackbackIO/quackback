/**
 * Changelog categories (labels) and the entry <-> category link table
 * (Changelog Settings §2). Categories are name + color labels an admin
 * manages from Settings > Changelog > Labels; `segmentIds` is the cheap
 * per-category audience gate ("only show this category to [segments]") —
 * an empty array means everyone. `position` drives manual ordering in the
 * Labels list and the public/widget filter chips.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { changelogEntries } from './changelog'

export const changelogCategories = pgTable(
  'changelog_categories',
  {
    id: typeIdWithDefault('changelog_category')('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    // Segments this category is restricted to; [] = everyone (no gating).
    segmentIds: jsonb('segment_ids').$type<string[]>().notNull().default([]),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Case-insensitively unique label names.
    uniqueIndex('changelog_category_name_lower_idx').on(sql`lower(${table.name})`),
    index('changelog_category_position_idx').on(table.position),
  ]
)

// Junction table for linking changelog entries to categories (M:N). Composite
// PK (no surrogate id) — mirrors the entry <-> post link table's shape.
export const changelogEntryCategories = pgTable(
  'changelog_entry_categories',
  {
    changelogEntryId: typeIdColumn('changelog')('changelog_entry_id')
      .notNull()
      .references(() => changelogEntries.id, { onDelete: 'cascade' }),
    categoryId: typeIdColumn('changelog_category')('category_id')
      .notNull()
      .references(() => changelogCategories.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.changelogEntryId, table.categoryId] }),
    index('changelog_entry_categories_category_idx').on(table.categoryId),
  ]
)

export const changelogCategoriesRelations = relations(changelogCategories, ({ many }) => ({
  entryLinks: many(changelogEntryCategories),
}))

export const changelogEntryCategoriesRelations = relations(changelogEntryCategories, ({ one }) => ({
  changelogEntry: one(changelogEntries, {
    fields: [changelogEntryCategories.changelogEntryId],
    references: [changelogEntries.id],
  }),
  category: one(changelogCategories, {
    fields: [changelogEntryCategories.categoryId],
    references: [changelogCategories.id],
  }),
}))
