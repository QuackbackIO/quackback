// Database client — import from '@quackback/db/client' directly to avoid
// pulling postgres into the client bundle via Vite's module scanner.
export type { Database, CreateDbOptions } from './src/client'

// Schema
export * from './src/schema'

// RBAC permission catalogue (pure data; the code-authoritative contract)
export * from './src/rbac-catalogue'

// page_views partition maintenance (SQL helpers; take a Database, import no client)
export { ensurePageViewPartitions, dropExpiredPageViewPartitions } from './src/page-view-partitions'

// Visitor analytics rollup (hourly recompute of visitor_stats_daily + visitor_top_stats)
export { refreshVisitorAnalytics, VISITOR_PERIODS } from './src/visitor-rollup'

// Migration ledger status (bundled journal vs applied rows; readiness probe)
export { getMigrationStatus, type MigrationStatus } from './src/migration-status'

// Types
export * from './src/types'

// Re-export common drizzle-orm utilities
export {
  eq,
  and,
  or,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  sql,
  desc,
  asc,
  count,
  sum,
  avg,
  min,
  max,
} from 'drizzle-orm'
