import { pgTable, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core'
export const integrationDeliveries = pgTable(
  'integration_deliveries',
  {
    provider: text('provider').notNull(),
    deliveryId: text('delivery_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.deliveryId] }),
    index('integration_deliveries_received_idx').on(table.receivedAt),
  ]
)
