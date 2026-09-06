import { pgTable, text, timestamp, primaryKey, foreignKey } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'
export const slackUserLinks = pgTable(
  'slack_user_links',
  {
    slackTeamId: text('slack_team_id').notNull(),
    slackUserId: text('slack_user_id').notNull(),
    principalId: typeIdColumn('principal')('principal_id').notNull(),
    method: text('method', { enum: ['email', 'manual'] }).notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    suggestedPromptsAt: timestamp('suggested_prompts_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: 'slack_user_links_pkey', columns: [table.slackTeamId, table.slackUserId] }),
    foreignKey({
      name: 'slack_user_links_principal_id_fkey',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
  ]
)
