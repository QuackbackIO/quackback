import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { boards } from './boards'

export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: typeIdWithDefault('changelog')('id').primaryKey(),
    boardId: typeIdColumn('board')('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('changelog_board_id_idx').on(table.boardId),
    index('changelog_published_at_idx').on(table.publishedAt),
  ]
)

export const changelogEntriesRelations = relations(changelogEntries, ({ one }) => ({
  board: one(boards, {
    fields: [changelogEntries.boardId],
    references: [boards.id],
  }),
}))
