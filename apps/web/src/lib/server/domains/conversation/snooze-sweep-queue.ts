/**
 * Snooze-wake sweeper — a per-minute job that reopens snoozed conversations
 * whose wake timer has elapsed (see sweepDueSnoozedConversations), publishing
 * the same realtime/inbox updates a manual reopen does.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'snooze-sweep' })

export async function runSnoozeSweep(): Promise<void> {
  const { sweepDueSnoozedConversations } = await import('./conversation.service')
  const result = await sweepDueSnoozedConversations()
  if (result.woken > 0) {
    log.debug({ woken: result.woken }, 'snooze-sweep run complete')
  }

  // Ride the same per-minute tick to close out assistant involvements that have
  // gone quiet (assumed resolution). Best-effort: an assistant sweep failure
  // must not fail the snooze wake.
  try {
    const { finalizeStaleAssistantInvolvements } = await import('@/lib/server/domains/assistant')
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
    const { sweepAndNotifyExpiredPendingActions } =
      await import('@/lib/server/domains/assistant/pending-actions.service')
    const expired = await sweepAndNotifyExpiredPendingActions()
    if (expired.length > 0) {
      log.debug({ expired: expired.length }, 'assistant pending-action expiry sweep complete')
    }
  } catch (err) {
    log.warn({ err }, 'assistant pending-action expiry sweep failed')
  }
}
