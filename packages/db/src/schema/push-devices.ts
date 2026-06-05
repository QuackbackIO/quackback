import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'

/**
 * Push notification devices for the mobile agent app. One row per APNs/FCM
 * registration token, owned by the agent's principal. Scoped to the tenant by
 * the database connection (database-per-tenant); no workspace column.
 *
 * Generic by design: registering a device says nothing about "cloud" or any
 * specific app — a self-hoster who never ships an app simply never writes here.
 * An external push consumer reads this table to deliver notifications.
 */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: typeIdWithDefault('push_device')('id').primaryKey(),
    // The agent this device belongs to. `cascade` so deleting a principal
    // cleans up their device rows.
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    // The APNs/FCM registration token. Unique so a re-register upserts in place
    // (a token can only ever belong to one principal at a time).
    token: text('token').notNull(),
    platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
    // Bumped on every re-register so stale tokens can be pruned later.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('push_devices_token_idx').on(table.token),
    index('push_devices_principal_idx').on(table.principalId),
  ]
)
