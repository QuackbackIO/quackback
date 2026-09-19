/**
 * The `assistant-action` queue handler.
 *
 * Every import here is static, deliberately, for the same reason the
 * assistant-turn handler's are: the job worker primes handler modules once at
 * tier start, outside any workspace scope, and that guarantee reaches exactly
 * as far as the static import graph (jobs/__tests__/handler-imports.test.ts is
 * the guard).
 *
 * Unlike the turn queue, this one may retry. That is safe here and nowhere
 * else in this feature: execution is claimed on the receipt's action key, so a
 * second attempt finds the first attempt's receipt and answers from it. A
 * retry can finish the bookkeeping around a dispatched effect; it can never
 * repeat the effect.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { ASSISTANT_ACTION_QUEUE } from './pending-actions.service'
import { runApprovedAssistantAction } from './assistant-action.executor'

const log = logger.child({ component: 'assistant-action-queue' })

export { ASSISTANT_ACTION_QUEUE }

/**
 * A single provider call plus the settlement around it. Shorter than a turn's
 * lease because nothing here waits on a model.
 */
export const ASSISTANT_ACTION_LEASE_MS = 120_000

/** Approvals arrive in ones and twos, not as a backlog. */
export const ASSISTANT_ACTION_CONCURRENCY = 2

/** The queue handler. A refusal is a recorded answer, not a thrown job failure. */
export async function runAssistantActionJob(job: ClaimedJob): Promise<void> {
  const disposition = await runApprovedAssistantAction(job)
  log.info(
    { event: 'assistant_action.finished', job_id: job.jobId, disposition },
    'assistant action job finished'
  )
}
