/**
 * page_views partition maintenance — a daily job that pre-creates day
 * partitions a week ahead and drops partitions past the retention window (see
 * @quackback/db page-view-partitions).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 *
 * The boot-time ensure that used to sit alongside the BullMQ queue construction
 * is now `ensurePageViewPartitionsAtBoot()`, called from the startup path with a
 * real workspace scope. It cannot live here as an import side effect: under pooled
 * tenancy `db` throws without a scope, and a module that queried on import would
 * be a boot-time landmine for every process that merely referenced the handler.
 */
import { logger } from '@/lib/server/logger'
import { db, ensurePageViewPartitions, dropExpiredPageViewPartitions } from '@/lib/server/db'

const log = logger.child({ component: 'page-view-partitions' })

const RETENTION_DAYS = 90

export async function runPageViewPartitionMaintenance(): Promise<void> {
  await ensurePageViewPartitions(db)
  const dropped = await dropExpiredPageViewPartitions(db, { retentionDays: RETENTION_DAYS })
  if (dropped.length > 0) {
    log.info({ dropped }, 'dropped expired page_views partitions')
  }
}

/**
 * Heal the partition window at boot rather than waiting for the next daily
 * slot — beacons drop while a day has no partition, so an instance that was down
 * long enough to exhaust its window must not wait until 02:30.
 */
export async function ensurePageViewPartitionsAtBoot(): Promise<void> {
  await ensurePageViewPartitions(db)
}
