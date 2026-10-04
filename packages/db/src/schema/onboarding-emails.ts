import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'

/** The setup emails a teammate has been sent: the welcome and the day-two nudge, once each. */
export const onboardingEmails = pgTable(
  'onboarding_emails',
  {
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['welcome', 'nudge'] }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('onboarding_emails_principal_kind_idx').on(table.principalId, table.kind)]
)
