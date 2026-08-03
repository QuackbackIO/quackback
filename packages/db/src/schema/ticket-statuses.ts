/**
 * Ticket statuses — workflow states for the ticketing module.
 *
 * Intentionally separate from `post_statuses` (feedback workflow) so the two
 * pipelines can evolve independently and a status configuration change in
 * one product never accidentally surfaces tickets on the public roadmap.
 *
 * Categories
 *   - `open`     active queue items awaiting agent action
 *   - `pending`  waiting on the customer (pauses SLA in Phase 5)
 *   - `on_hold`  waiting on a third party / engineering (pauses SLA)
 *   - `solved`   agent considers the issue resolved (resolution timer stops)
 *   - `closed`   no further activity expected
 */
import { pgTable, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

export const TICKET_STATUS_CATEGORIES = ['open', 'pending', 'on_hold', 'solved', 'closed'] as const
export type TicketStatusCategory = (typeof TICKET_STATUS_CATEGORIES)[number]

export const ticketStatuses = pgTable(
  'ticket_statuses',
  {
    id: typeIdWithDefault('ticket_status')('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    color: text('color').notNull().default('#6b7280'),
    category: text('category', { enum: TICKET_STATUS_CATEGORIES }).notNull().default('open'),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ticket_statuses_position_idx').on(t.category, t.position),
    index('ticket_statuses_deleted_at_idx').on(t.deletedAt),
  ]
)

/**
 * Default statuses seeded by migration 0050. Mirrors `DEFAULT_STATUSES` for
 * posts but uses ticket-appropriate categories.
 */
export const DEFAULT_TICKET_STATUSES: Array<{
  name: string
  slug: string
  color: string
  category: TicketStatusCategory
  position: number
  isDefault: boolean
  isSystem: boolean
}> = [
  {
    name: 'Open',
    slug: 'open',
    color: '#3b82f6',
    category: 'open',
    position: 0,
    isDefault: true,
    isSystem: true,
  },
  {
    name: 'Pending',
    slug: 'pending',
    color: '#eab308',
    category: 'pending',
    position: 1,
    isDefault: false,
    isSystem: true,
  },
  {
    name: 'On hold',
    slug: 'on_hold',
    color: '#a855f7',
    category: 'on_hold',
    position: 2,
    isDefault: false,
    isSystem: true,
  },
  {
    name: 'Solved',
    slug: 'solved',
    color: '#22c55e',
    category: 'solved',
    position: 3,
    isDefault: false,
    isSystem: true,
  },
  {
    name: 'Closed',
    slug: 'closed',
    color: '#6b7280',
    category: 'closed',
    position: 4,
    isDefault: false,
    isSystem: true,
  },
]
