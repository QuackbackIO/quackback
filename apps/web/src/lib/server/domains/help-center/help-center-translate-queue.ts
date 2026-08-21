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
 */
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
}

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const HELP_CENTER_TRANSLATE_QUEUE = 'help-center-translate'

export async function enqueueHelpCenterTranslateJob(data: HelpCenterTranslateJob): Promise<void> {
  await enqueueJob({
    queue: HELP_CENTER_TRANSLATE_QUEUE,
    payload: { ...data },
    // Was BullMQ's `attempts: 3` with exponential backoff from 5s; the
    // definition carries the same numbers.
    maxAttempts: 3,
  })
}

/** Translate one article into one locale. */
export async function runHelpCenterTranslate(job: ClaimedJob): Promise<void> {
  const data = job.payload as unknown as HelpCenterTranslateJob
  switch (data.type) {
    case 'translate-article': {
      await translateArticleForLocale(data.articleId as KbArticleId, data.locale)
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
