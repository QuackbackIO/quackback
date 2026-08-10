/**
 * Snooze-wake sweeper — a per-minute job that reopens snoozed conversations
 * whose wake timer has elapsed (see sweepDueSnoozedConversations), publishing
 * the same realtime/inbox updates a manual reopen does.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`. Every collaborator is imported statically so
 * `primeJobHandlers()` loads it outside any workspace scope — see
 * sla-breach-sweep-queue.ts for why that matters.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { dueWithin, registerWorkspaceDeadline } from '@/lib/server/jobs/deadlines'
import {
  ASSUMED_RESOLUTION_INACTIVITY_MINUTES,
  finalizeStaleAssistantInvolvements,
} from '@/lib/server/domains/assistant'
import { sweepAndNotifyExpiredPendingActions } from '@/lib/server/domains/assistant/pending-actions.service'
import { sweepDueSnoozedConversations } from './conversation.service'

const log = logger.child({ component: 'snooze-sweep' })

/**
 * When this workspace's snooze tick next has anything to do — or null, if it never
 * does.
 *
 * Three independent clocks ride this one job, so the answer is the earliest of
 * three, and **all three must be here**. A deadline source left out would be one
 * whose work is silently deferred to the rescan interval on an idle workspace,
 * which is the failure mode this whole mechanism has to not have. Each arm
 * mirrors its sweep's own predicate exactly:
 *
 * - `sweepDueSnoozedConversations` wakes `status='snoozed' AND snoozed_until <= now`
 * - `finalizeStaleAssistantInvolvements` closes `status='active'` involvements
 *   whose `last_assistant_answer_at` is older than the inactivity threshold, so
 *   the deadline is that timestamp *plus* the threshold
 * - `expireStalePendingActions` expires `status='proposed' AND expires_at < now`
 *
 * One statement rather than three round trips, each arm on the partial index its
 * sweep already scans. `LEAST` ignores NULLs, so a workspace with only one kind of
 * pending work gets that one's instant rather than null.
 */
async function nextSnoozeTickAt(): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT LEAST(
      (SELECT min(snoozed_until) FROM conversations
        WHERE status = 'snoozed' AND snoozed_until IS NOT NULL),
      (SELECT min(last_assistant_answer_at)
              + make_interval(mins => ${ASSUMED_RESOLUTION_INACTIVITY_MINUTES})
         FROM assistant_involvements WHERE status = 'active'),
      (SELECT min(expires_at) FROM assistant_pending_actions WHERE status = 'proposed')
    ) AS due_at
  `)
  const rows = getExecuteRows<{ due_at: Date | string | null }>(result)
  const value = rows[0]?.due_at ?? null
  return value === null ? null : value instanceof Date ? value : new Date(value)
}

registerWorkspaceDeadline('snooze-sweep', nextSnoozeTickAt)

/**
 * The cron gate: is any of the three clocks due inside the next slot?
 *
 * The window is the schedule's own minute, so this can only ever suppress a tick
 * that would have found nothing — a snooze still reopens within a minute of its
 * timer elapsing, exactly as before.
 */
export function isSnoozeSweepDue(): Promise<boolean> {
  return dueWithin('snooze-sweep', 60_000)
}

export async function runSnoozeSweep(): Promise<void> {
  const result = await sweepDueSnoozedConversations()
  if (result.woken > 0) {
    log.debug({ woken: result.woken }, 'snooze-sweep run complete')
  }

  // Ride the same per-minute tick to close out assistant involvements that have
  // gone quiet (assumed resolution). Best-effort: an assistant sweep failure
  // must not fail the snooze wake.
  try {
    const { resolved } = await finalizeStaleAssistantInvolvements()
    if (resolved > 0) {
      log.debug({ resolved }, 'assistant assumed-resolution sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'assistant assumed-resolution sweep failed')
  }

  // Also expire pending actions nobody approved in time, and let the customer
  // know the request timed out rather than leaving them hanging. Best-effort,
  // same as the involvement sweep above.
  try {
    const expired = await sweepAndNotifyExpiredPendingActions()
    if (expired.length > 0) {
      log.debug({ expired: expired.length }, 'assistant pending-action expiry sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'assistant pending-action expiry sweep failed')
  }
}
