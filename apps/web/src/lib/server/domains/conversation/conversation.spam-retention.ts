/**
 * Spam retention: permanently deletes machine-filed spam conversations once
 * they are old enough that nobody is coming back for them.
 *
 * This exists because quarantining refused mail creates an obligation. A
 * message we refuse is now retained rather than destroyed, which is the whole
 * point — but "retained" without a ceiling means an unauthenticated stranger
 * decides how much storage this workspace spends, and the cold-inbound
 * throttle bounds the RATE at which that happens, never the total.
 *
 * THIRTY DAYS, and the number is a floor argument rather than a round one:
 *
 *  - The thing being held is mail we refused on a GUESS. A hard DMARC reject
 *    under a forwarding gateway is indistinguishable, from here, from a real
 *    customer whose mail lost SPF/DKIM alignment on the way. The realistic way
 *    that gets discovered is the customer chasing an email nobody answered,
 *    and a chase reliably takes longer than a fortnight. A window that expires
 *    before the complaint arrives is a window that retains nothing useful.
 *  - It is this codebase's existing retention idiom, not a new one:
 *    anon-sweep.service.ts reclaims abandoned anonymous principals at 30 days,
 *    and the job registry keeps failed `events` / `workflow-dispatch` rows for
 *    the same 30, precisely so "did this actually happen?" stays answerable.
 *
 * MANUAL FILINGS ARE NEVER SWEPT. `spam_reason = 'manual'` is an agent's own
 * decision about a thread, which makes it a record a person made rather than
 * machine output, and a timer that destroys those is destroying evidence
 * nobody asked it to. The Spam view's delete-forever is the tool for those,
 * and it is already a deliberate act.
 *
 * A RESTORED THREAD IS SAFE BY CONSTRUCTION. Releasing from Spam clears
 * `end_reason` and `spam_reason` (restoreConversationFromSpam), so a released
 * conversation stops matching the predicate below the moment it is released —
 * the sweep cannot delete a thread an agent has rescued, and that safety is a
 * property of the predicate rather than a race the sweep has to win.
 *
 * Hard delete, matching deleteConversationPermanently: every child row goes
 * with it through the FK cascades.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'spam-retention' })

/** How long a machine-filed spam conversation is held before deletion. */
export const SPAM_RETENTION_DAYS = 30

export interface SpamRetentionResult {
  /** Conversations deleted across every batch this call ran. */
  deleted: number
}

/**
 * Delete every auto-filed spam conversation whose filing is older than
 * `olderThanDays`, in batches of `batchSize`, until none remain.
 *
 * Batched the way anon-sweep.service.ts and workflow-retention.ts are: a
 * single unbounded DELETE against a workspace with a long-neglected Spam view
 * is one enormous transaction holding locks on a table the inbox reads, and
 * the cascade multiplies the row count well past what the conversation count
 * suggests.
 *
 * The clock is `resolved_at` — the instant of the filing — rather than
 * `created_at` or `last_message_at`. Those are properties of the message; the
 * retention promise is about how long we hold something AFTER refusing it.
 */
export async function sweepFiledSpamConversations(opts?: {
  olderThanDays?: number
  batchSize?: number
}): Promise<SpamRetentionResult> {
  const olderThanDays = opts?.olderThanDays ?? SPAM_RETENTION_DAYS
  const batchSize = opts?.batchSize ?? 500
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()

  let deleted = 0
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM conversations
      WHERE id IN (
        SELECT id FROM conversations
        WHERE status = 'closed'
          AND end_reason = 'spam'
          AND spam_reason IS NOT NULL
          AND spam_reason <> 'manual'
          AND resolved_at IS NOT NULL
          AND resolved_at < ${cutoffIso}::timestamptz
        LIMIT ${batchSize}
      )
      RETURNING id
    `)
    const batch = getExecuteRows<{ id: string }>(result).length
    deleted += batch
    if (batch < batchSize) break
  }

  if (deleted > 0) {
    log.info({ deleted, olderThanDays }, 'spam retention sweep deleted filed spam conversations')
  }
  return { deleted }
}
