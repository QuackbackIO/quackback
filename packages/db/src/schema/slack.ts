import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'
export const slackUserLinks = pgTable(
  'slack_user_links',
  {
    slackTeamId: text('slack_team_id').notNull(),
    slackUserId: text('slack_user_id').notNull(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['email', 'manual'] }).notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    suggestedPromptsAt: timestamp('suggested_prompts_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.slackTeamId, table.slackUserId] })]
)
