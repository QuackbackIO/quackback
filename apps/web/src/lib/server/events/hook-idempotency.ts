/**
 * Hook delivery idempotency.
 *
 * BullMQ retries on worker crashes — if a hook handler does its
 * side-effect (HTTP POST, OpenAI call, DB write) but crashes before
 * acking the job, BullMQ will re-run the handler on next boot.
 *
 * This module records every (jobId, hookType) pair in `hook_deliveries`
 * via INSERT … ON CONFLICT DO NOTHING. Handlers call
 * `claimHookDelivery(jobId, hookType)` before any side-effect; if the
 * row was already there, the function returns false and the handler
 * returns early.
 *
 * The race is "first writer wins": the INSERT is atomic in PG, so if
 * two workers ever process the same jobId in parallel (split-brain
 * during failover, e.g.) only one will succeed.
 */

import { db, hookDeliveries } from '@/lib/server/db'

/**
 * Try to claim a hook delivery for a job. Returns true on first call
 * for a given jobId; false on subsequent calls (already processed or
 * being processed by another worker).
 *
 * Falsy/empty jobIds short-circuit to true so callers without a stable
 * job ID (e.g. unit tests, ad-hoc dispatches) keep their old behaviour.
 */
export async function claimHookDelivery(
  jobId: string | undefined,
  hookType: string
): Promise<boolean> {
  if (!jobId) return true

  const inserted = await db
    .insert(hookDeliveries)
    .values({ jobId, hookType })
    .onConflictDoNothing()
    .returning({ jobId: hookDeliveries.jobId })

  return inserted.length > 0
}
