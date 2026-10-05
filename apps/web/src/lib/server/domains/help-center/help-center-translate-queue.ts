/**
 * Help-center auto-translate queue (domains/languages §H3).
 *
 * A dedicated queue rather than reusing feedback's AI queue: that queue's
 * handler would have to import back into help-center to process the job, and
 * help-center already imports the enqueue function — a two-way domain
 * dependency the dep-graph check treats as a new cycle requiring an explicit
 * decision.
 *
 * **The 120-second lease is the case the lease primitive was built for.** An AI
 * call can run long enough that a 30-second lock would let the job be declared
 * dead and re-dispatched — double-billing — before it finishes. Under BullMQ
 * that was `lockDuration: 120_000`; here it is `leaseMs` on the definition,
 * extended by heartbeat while the handler works, with no transaction open for
 * any of it.
 *
 * It is also the job that forced the runner's bounded pool. On a serial drain a
 * two-minute translation would have cost the per-minute sweeps two runs each,
 * and those runs would have been *dropped, not delayed* — see `jobs/JOBS.md`
 * §10.
 *
 * ## Pausing at the AI allowance
 *
 * A job that finds the allowance used up does not translate and does not fail.
 * It parks a pending row (`paused: true`) that runs when the allowance window
 * ends, one row per article and locale per window. The hourly resume sweep
 * releases parked rows early once allowance is back, for example after an
 * upgrade (`help-center-translate-resume.ts`). The parked rows are also what the editor reads to show an item as
 * paused.
 */
import { db, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import { logger } from '@/lib/server/logger'
import type { KbArticleId } from '@quackback/ids'
import { translateArticleForLocale } from './help-center-auto-translate.service'

const log = logger.child({ component: 'help-center-translate-queue' })

export interface HelpCenterTranslateJob {
  type: 'translate-article'
  articleId: string
  locale: string
  /** Set on a row parked because the AI allowance was used up. */
  paused?: true
}

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const HELP_CENTER_TRANSLATE_QUEUE = 'help-center-translate'

/** Was BullMQ's `attempts: 3`; the definition carries the same number. */
export const TRANSLATE_JOB_ATTEMPTS = 3

export async function enqueueHelpCenterTranslateJob(data: HelpCenterTranslateJob): Promise<void> {
  await enqueueJob({
    queue: HELP_CENTER_TRANSLATE_QUEUE,
    payload: { ...data },
    // Was BullMQ's `attempts: 3` with exponential backoff from 5s; the
    // definition carries the same numbers.
    maxAttempts: TRANSLATE_JOB_ATTEMPTS,
  })
}

/** Translate one article into one locale. */
export async function runHelpCenterTranslate(job: ClaimedJob): Promise<void> {
  const data = job.payload as unknown as HelpCenterTranslateJob
  switch (data.type) {
    case 'translate-article': {
      const pause = await translateArticleForLocale(data.articleId as KbArticleId, data.locale)
      if (pause) await parkPausedTranslation(data.articleId, data.locale, pause.pausedUntil)
      return
    }
    default:
      // Retrying cannot turn an unknown type into a known one.
      log.error({ type: (data as { type: string }).type }, 'unknown help-center-translate job type')
      throw new TerminalJobError(
        `Unknown help-center-translate job type: ${(data as { type: string }).type}`
      )
  }
}


/** Park an item until `until`; repeats within one window collapse to one row. */
async function parkPausedTranslation(articleId: string, locale: string, until: Date): Promise<void> {
  await enqueueJob({
    queue: HELP_CENTER_TRANSLATE_QUEUE,
    payload: { type: 'translate-article', articleId, locale, paused: true },
    dedupeKey: `paused:${articleId}:${locale}:${until.toISOString()}`,
    runAt: until,
    maxAttempts: TRANSLATE_JOB_ATTEMPTS,
  })
}

/** Locales of `articleId` whose auto-translation is parked at the AI allowance. */
export async function listPausedTranslationLocales(articleId: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT payload->>'locale' AS locale
    FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE}
      AND status = 'pending'
      AND payload->>'paused' = 'true'
      AND payload->>'articleId' = ${articleId}
    ORDER BY 1
  `)
  return getExecuteRows<{ locale: string }>(result).map((r) => r.locale)
}
