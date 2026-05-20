/**
 * Hook delivery idempotency table.
 *
 * Records every hook job that has been (or is being) processed, keyed by
 * the BullMQ job ID. Handlers do an INSERT … ON CONFLICT DO NOTHING
 * before the side-effecting work; if the conflict triggers, the job has
 * already been (or is being) processed and the handler returns early.
 *
 * This closes a long-standing gap where worker crashes mid-handler caused
 * BullMQ to re-run the job on the next boot — re-firing webhooks (visible
 * to customers as duplicate deliveries) and re-billing OpenAI for
 * sentiment + embedding work that already completed.
 *
 * `processedAt` lets us prune rows older than the BullMQ retention window
 * (rows for completed jobs older than 24h are useless because BullMQ has
 * forgotten the job by then).
 */
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

export const hookDeliveries = pgTable(
  'hook_deliveries',
  {
    /** BullMQ job ID — primary key. Format depends on the queue, but is
     *  always a string opaque to this table. */
    jobId: text('job_id').primaryKey(),
    /** Hook type that processed this job (e.g. 'webhook', 'ai'). Useful
     *  for debugging + retention sweeps that target one hook type. */
    hookType: text('hook_type').notNull(),
    /** Wall-clock time the row was inserted. Used by retention pruning. */
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Prune query: DELETE WHERE processed_at < now() - interval '7 days'
    index('hook_deliveries_processed_at_idx').on(table.processedAt),
  ]
)
