/**
 * Every startup backfill this build runs, in the order the pass enqueues them.
 *
 * Add an entry here, never a data change over a hot table in a numbered
 * migration (`packages/db/MIGRATIONS.md`). Each entry's walks must pass the
 * shared backfill test (`__tests__/batched.test.ts`).
 */
import type { BatchedBackfill } from './batched'
import { ticketFirstResponseBackfill } from '@/lib/server/domains/tickets/ticket-first-response.backfill'

export const BATCHED_BACKFILLS: readonly BatchedBackfill[] = [ticketFirstResponseBackfill]
