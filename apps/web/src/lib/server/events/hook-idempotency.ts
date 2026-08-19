/**
 * Hook delivery idempotency.
 *
 * BullMQ retries on worker crashes — if a hook handler does its
 * side-effect (HTTP POST, OpenAI call, DB write) but crashes before
 * acking the job, BullMQ will re-run the handler on next boot.
 *
 * This module records an outcome-aware lease for each (jobId, hookType).
 * Stale processing leases are reclaimable after a worker crash; completed
 * and terminal-failure rows remain durable dedupe records. Handlers call
 * `claimHookDelivery(jobId, hookType)` before any side-effect; if the
 * row was already there, the function returns false and the handler
 * returns early.
 *
 * The race is "first writer wins": the upsert is atomic in PG, so if
 * two workers ever process the same jobId in parallel (split-brain
 * during failover, e.g.) only one will succeed.
 */

import { db, hookDeliveries, eq, sql } from '@/lib/server/db'

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

  const result = await db.execute<{ job_id: string }>(sql`
    INSERT INTO hook_deliveries (job_id, hook_type, outcome, processed_at)
    VALUES (${jobId}, ${hookType}, 'processing', now())
    ON CONFLICT (job_id) DO UPDATE
      SET hook_type = excluded.hook_type,
          outcome = 'processing',
          processed_at = now()
      WHERE hook_deliveries.outcome = 'processing'
        AND hook_deliveries.processed_at < now() - interval '5 minutes'
    RETURNING job_id
  `)

  return Array.from(result as Iterable<{ job_id: string }>).length > 0
}

export async function completeHookDelivery(jobId: string | undefined): Promise<void> {
  if (!jobId) return
  await db
    .update(hookDeliveries)
    .set({ outcome: 'completed', processedAt: new Date() })
    .where(eq(hookDeliveries.jobId, jobId))
}

export async function failHookDelivery(jobId: string | undefined): Promise<void> {
  if (!jobId) return
  await db
    .update(hookDeliveries)
    .set({ outcome: 'failed', processedAt: new Date() })
    .where(eq(hookDeliveries.jobId, jobId))
}

/** Release a pre-delivery claim after a retryable failure so BullMQ's next
 * attempt performs the delivery. Terminal failures and successes keep the
 * row, preserving deduplication for replays and worker crashes. */
export async function releaseHookDelivery(jobId: string | undefined): Promise<void> {
  if (!jobId) return
  await db.delete(hookDeliveries).where(eq(hookDeliveries.jobId, jobId))
}
