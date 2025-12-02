import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { boards } from './boards'
import { appUser } from './rls'

const changelogOrgCheck = sql`board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
)`

export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
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
    pgPolicy('changelog_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: changelogOrgCheck,
      withCheck: changelogOrgCheck,
    }),
  ]
).enableRLS()

export const changelogEntriesRelations = relations(changelogEntries, ({ one }) => ({
  board: one(boards, {
    fields: [changelogEntries.boardId],
    references: [boards.id],
  }),
}))
