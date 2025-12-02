import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { boards } from './boards'
import { appUser } from './rls'

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    config: jsonb('config').default({}).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'error'],
    }).default('inactive').notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('integrations_org_id_idx').on(table.organizationId),
    index('integrations_type_idx').on(table.type),
    index('integrations_board_id_idx').on(table.boardId),
    pgPolicy('integrations_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
    }),
  ]
).enableRLS()
