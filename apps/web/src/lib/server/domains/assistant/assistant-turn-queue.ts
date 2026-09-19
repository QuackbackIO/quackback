/**
 * The `assistant-turn` queue handler.
 *
 * Every import here is static, deliberately: the job worker primes handler
 * modules once at tier start, OUTSIDE any workspace scope, and that guarantee
 * reaches exactly as far as the static import graph. A call-time `import()`
 * would run the imported module's top level under whichever workspace claimed
 * the first job (jobs/__tests__/handler-imports.test.ts is the guard).
 *
 * The turn job still runs with `maxAttempts: 1`. The reason has changed: tool
 * receipts are replay-safe now (P3), so a second attempt can no longer repeat
 * an effect, and the remaining gate is the one P4 names, which is confirming
 * durable customer mode under two workers before more than one attempt is
 * allowed to generate into the same conversation.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { ASSISTANT_TURN_QUEUE } from './assistant-run.service'
import { advanceAssistantRun } from './assistant-run.executor'

const log = logger.child({ component: 'assistant-turn-queue' })

export { ASSISTANT_TURN_QUEUE }

/**
 * Long enough for a full agentic generation to finish without the reaper taking
 * the job, short enough that a dead worker's conversation is not stuck for
 * minutes. The handler heartbeats, so this bounds "how long after a process
 * death before the row is adjudicated", not how long a turn may take.
 */
export const ASSISTANT_TURN_LEASE_MS = 180_000

/** Interactive work, so a small pool: two turns per process, not a backlog drain. */
export const ASSISTANT_TURN_CONCURRENCY = 2

/** The queue handler. Never throws for an ordinary lost race; see advanceAssistantRun. */
export async function runAssistantTurnJob(job: ClaimedJob): Promise<void> {
  const disposition = await advanceAssistantRun(job)
  log.info(
    { event: 'assistant_turn.finished', job_id: job.jobId, disposition },
    'assistant turn job finished'
  )
}
