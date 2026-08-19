/**
 * Events outbox retention compactor (EVENTING-V2 WO-20).
 *
 * Published rows are the durable log (per-entity timeline, "did it fire?"
 * diagnostics, admin-initiated backfill) but they are not needed forever. This
 * sweep prunes published rows older than the retention window, mirroring the
 * audit-log prune wired in startup.ts. It NEVER deletes unpublished rows — an
 * undelivered event must survive until the relay drains it, however far behind.
 *
 * The hot outbox drain path is served by the partial `events_unpublished_idx`,
 * so it stays fast regardless of how many published rows accumulate; retention
 * is about disk, not drain latency.
 */
import { db, events, and, isNotNull, lt } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'events-sweep' })

/** Default retention for published outbox rows. */
export const DEFAULT_EVENTS_RETENTION_DAYS = 90

/**
 * Delete published events older than `retentionDays`. Returns the number of
 * rows removed. Unpublished rows are always retained.
 */
export async function pruneEventsOutbox(
  retentionDays = DEFAULT_EVENTS_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const deleted = await db
    .delete(events)
    .where(and(isNotNull(events.publishedAt), lt(events.publishedAt, cutoff)))
    .returning({ id: events.id })
  if (deleted.length > 0) {
    log.info({ pruned: deleted.length, retention_days: retentionDays }, 'events outbox pruned')
  }
  return deleted.length
}
