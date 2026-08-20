/**
 * Anonymous-principal sweep — a daily job that reclaims abandoned empty anon
 * principals (see anon-sweep.service).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`) rather than on Redis. The
 * schedule and the retry policy live in `jobs/definitions.ts`; this module is
 * just the handler, which is the whole point of the move — the queue mechanism
 * is no longer duplicated in every sweep module.
 */
import { logger } from '@/lib/server/logger'
import { sweepAnonymousPrincipals } from './anon-sweep.service'

const log = logger.child({ component: 'anon-sweep' })

export async function runAnonSweep(): Promise<void> {
  const result = await sweepAnonymousPrincipals()
  if (result.deleted > 0 || result.candidates > 0) {
    log.debug({ candidates: result.candidates, deleted: result.deleted }, 'anon-sweep run complete')
  }
}
