/**
 * Sending-domain re-check — a daily job that re-asks both authorities about
 * every customer-owned sending domain and demotes the ones that have stopped
 * being true (see sending-identity.ts's `sweepSendingDomains`, which states
 * what can stop being true and why silence about it is the expensive outcome).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { sweepSendingDomains } from './sending-identity'

const log = logger.child({ component: 'sending-domain-recheck' })

export async function runSendingDomainRecheck(): Promise<void> {
  const result = await sweepSendingDomains()
  if (result.checked > 0) {
    log.debug(result, 'sending-domain re-check complete')
  }
}
