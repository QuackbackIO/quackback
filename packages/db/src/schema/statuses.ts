import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { appUser } from './rls'
import { STATUS_CATEGORIES, type StatusCategory } from '../types'

// Re-export for convenience (canonical source is ../types.ts)
export { STATUS_CATEGORIES, type StatusCategory }

export const postStatuses = pgTable(
  'post_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull().default('#6b7280'),
    category: text('category', { enum: STATUS_CATEGORIES }).notNull().default('active'),
    position: integer('position').notNull().default(0),
    showOnRoadmap: boolean('show_on_roadmap').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('post_statuses_org_slug_idx').on(table.organizationId, table.slug),
    index('post_statuses_org_id_idx').on(table.organizationId),
    index('post_statuses_position_idx').on(table.organizationId, table.category, table.position),
    pgPolicy('post_statuses_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
    }),
  ]
).enableRLS()

// Relations are defined in posts.ts to avoid circular dependency

// Default statuses to seed for new organizations
export const DEFAULT_STATUSES: Array<{
  name: string
  slug: string
  color: string
  category: StatusCategory
  position: number
  showOnRoadmap: boolean
  isDefault: boolean
}> = [
  // Active statuses
  {
    name: 'Open',
    slug: 'open',
    color: '#3b82f6',
    category: 'active',
    position: 0,
    showOnRoadmap: false,
    isDefault: true,
  },
  {
    name: 'Under Review',
    slug: 'under_review',
    color: '#eab308',
    category: 'active',
    position: 1,
    showOnRoadmap: false,
    isDefault: false,
  },
  {
    name: 'Planned',
    slug: 'planned',
    color: '#a855f7',
    category: 'active',
    position: 2,
    showOnRoadmap: true,
    isDefault: false,
  },
  {
    name: 'In Progress',
    slug: 'in_progress',
    color: '#f97316',
    category: 'active',
    position: 3,
    showOnRoadmap: true,
    isDefault: false,
  },
  // Complete statuses
  {
    name: 'Complete',
    slug: 'complete',
    color: '#22c55e',
    category: 'complete',
    position: 0,
    showOnRoadmap: true,
    isDefault: false,
  },
  // Closed statuses
  {
    name: 'Closed',
    slug: 'closed',
    color: '#6b7280',
    category: 'closed',
    position: 0,
    showOnRoadmap: false,
    isDefault: false,
  },
]
