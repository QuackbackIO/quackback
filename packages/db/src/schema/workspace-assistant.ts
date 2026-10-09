import { pgTable, text, timestamp, integer, index, foreignKey } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'

/** Ownership, ordering and turn leases for private workspace conversations. */
export const workspaceAssistantThreads = pgTable(
  'workspace_assistant_threads',
  {
    key: text('key').primaryKey(),
    ownerPrincipalId: typeIdColumn('principal')('owner_principal_id').notNull(),
    title: text('title').notNull().default(''),
    revision: integer('revision').notNull().default(0),
    activeRunId: text('active_run_id'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'workspace_assistant_threads_owner_principal_id_fkey',
      columns: [table.ownerPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
    index('workspace_assistant_threads_owner_updated_idx').on(
      table.ownerPrincipalId,
      table.updatedAt,
      table.key
    ),
  ]
)
