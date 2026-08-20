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

// External side-effect ledger: per-column restore policy (pure data + the
// guard's detection helpers) and the entry point a restore path calls so
// already-sent mail, webhooks and announcements are not sent again.
export * from './src/side-effect-ledger'
export {
  settleExternalSideEffects,
  planSideEffectSettlement,
  RESTORE_SETTLEMENT_AUDIT_EVENT,
  type SettlementStep,
  type AppliedSettlementStep,
  type SettlementReport,
  type SettlementAction,
  type SettleExternalSideEffectsOptions,
} from './src/settle-external-side-effects'

// Migration ledger status (bundled journal vs applied rows; readiness probe)
export { getMigrationStatus, type MigrationStatus } from './src/migration-status'

// The schema steps that run OUTSIDE drizzle's migration transaction, and the
// post-condition sweep that checks the database rather than the ledger.
// Exported so the fleet migrator role reuses them instead of shelling out to
// the CLI or duplicating the index list (SAAS-HOSTING-STACK.md §10.2).
export {
  CONCURRENT_INDEX_SPECS,
  MIGRATION_LOCK_KEY,
  REQUIRED_EXTENSIONS,
  dropInvalidIndexes,
  ensureConcurrentIndexes,
  ensureExtensions,
  listInvalidIndexes,
  verifySchemaPostconditions,
  type ConcurrentIndexSpec,
  type DropInvalidResult,
  type InvalidIndex,
  type PostconditionReport,
  type PostconditionViolation,
} from './src/schema-ops'

// System-data reconcile (statuses, RBAC catalogue, preset bundles, assignment
// backfill + heal) — exported so integration tests can exercise the heal.
export { seedSystemData } from './src/seed-system'

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
