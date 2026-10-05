/**
 * The resume sweep for help-center auto-translations parked at the AI
 * allowance (see `help-center-translate-queue.ts`). Parked rows run on their
 * own when the allowance window ends; this brings them forward as soon as
 * allowance is available again, for example after an upgrade.
 */
import { db, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { enqueueJobs, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getAiBudgetStatus } from '@/lib/server/domains/ai/ai-budget'
import { logger } from '@/lib/server/logger'
import { HELP_CENTER_TRANSLATE_QUEUE, TRANSLATE_JOB_ATTEMPTS } from './help-center-translate-queue'

const log = logger.child({ component: 'help-center-translate-resume' })

/** Cron gate for the resume sweep: true while anything is parked. */
export async function hasPausedTranslations(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE}
      AND status = 'pending'
      AND payload->>'paused' = 'true'
    LIMIT 1
  `)
  return getExecuteRows(result).length > 0
}

/**
 * Release parked items once the AI allowance is available again.
 *
 * One transaction: the parked rows are deleted first and the replacements are
 * inserted on the same transaction, so no other connection ever sees a
 * replacement while its parked row still holds the dedupe key. Without that, a
 * worker could claim the replacement, find the allowance used up again, fail
 * to park (dedupe hit on the old row) and drop the item.
 */
export async function runHelpCenterTranslateResume(_job: ClaimedJob): Promise<void> {
  if (!(await hasPausedTranslations())) return
  if ((await getAiBudgetStatus()).exhausted) return

  const resumed = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      DELETE FROM job_queue
      WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE}
        AND status = 'pending'
        AND payload->>'paused' = 'true'
      RETURNING payload->>'articleId' AS article_id, payload->>'locale' AS locale
    `)
    const parked = getExecuteRows<{ article_id: string; locale: string }>(result)
    if (parked.length === 0) return 0

    const unique = new Map(parked.map((r) => [`${r.article_id}:${r.locale}`, r]))
    await enqueueJobs(
      [...unique.values()].map((r) => ({
        queue: HELP_CENTER_TRANSLATE_QUEUE,
        payload: { type: 'translate-article', articleId: r.article_id, locale: r.locale },
        maxAttempts: TRANSLATE_JOB_ATTEMPTS,
      })),
      { executor: tx }
    )
    return unique.size
  })
  if (resumed > 0) log.info({ resumed }, 'auto-translate resumed: AI allowance available')
}
