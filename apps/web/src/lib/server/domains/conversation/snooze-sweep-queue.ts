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
  finalizeStaleAssistantInvolvements,
  sendStaleAssistantFollowUps,
} from '@/lib/server/domains/assistant'
import { sweepAndNotifyExpiredPendingActions } from '@/lib/server/domains/assistant/pending-actions.service'
import { sweepDueSnoozedConversations } from './conversation.service'
import { sweepIdleTeamConversations } from './conversation.idle-sweep'

const log = logger.child({ component: 'snooze-sweep' })

/**
 * When this workspace's snooze tick next has anything to do — or null, if it never
 * does.
 *
 * Independent clocks ride this one job, so the answer is the earliest of
 * every arm, and **all of them must be here**. A deadline source left out
 * would be deferred to the rescan interval on an idle workspace. Each arm
 * mirrors its sweep's own predicate:
 *
 * - `sweepDueSnoozedConversations` wakes `status='snoozed' AND snoozed_until <= now`
 * - Quinn and team follow-up/closure share the persisted inactivity owner and
 *   activity anchor, channel ownership, snooze and interactive-workflow guards.
 * - `expireStalePendingActions` expires `status='proposed' AND expires_at < now`
 *
 * `LEAST` ignores NULLs; nextInactivityDeadline shares the worker predicates.
 */
async function nextSnoozeTickAt(): Promise<Date | null> {
  const { nextInactivityDeadline } = await import('./conversation.inactivity')
  const inactivityAt = await nextInactivityDeadline()
  const result = await db.execute(sql`SELECT LEAST(
    (SELECT min(snoozed_until) FROM conversations WHERE status = 'snoozed' AND snoozed_until IS NOT NULL),
    (SELECT min(expires_at) FROM assistant_pending_actions WHERE status = 'proposed'),
    ${inactivityAt?.toISOString() ?? null}::timestamptz
  ) AS due_at`)
  const value = getExecuteRows<{ due_at: Date | string | null }>(result)[0]?.due_at
  return value ? new Date(value) : null
}

registerWorkspaceDeadline('snooze-sweep', nextSnoozeTickAt)

/**
 * The cron gate: is any clock due inside the next slot?
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

  // Ride the same per-minute tick: Quinn follow-up, then assumed/abandoned
  // close, then team-handled idle check-in/close. Best-effort — none of these
  // may fail the snooze wake.
  try {
    const followedUp = await sendStaleAssistantFollowUps()
    if (followedUp > 0) {
      log.debug({ followedUp }, 'assistant follow-up sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'assistant follow-up sweep failed')
  }

  try {
    const { resolved, abandoned } = await finalizeStaleAssistantInvolvements()
    if (resolved > 0 || abandoned > 0) {
      log.debug({ resolved, abandoned }, 'assistant assumed-resolution sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'assistant assumed-resolution sweep failed')
  }

  try {
    const { checkedIn, closed } = await sweepIdleTeamConversations()
    if (checkedIn > 0 || closed > 0) {
      log.debug({ checkedIn, closed }, 'team idle sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'team idle sweep failed')
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
