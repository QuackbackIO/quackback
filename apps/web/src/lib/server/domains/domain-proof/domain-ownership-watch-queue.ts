/**
 * Domain ownership watch: the daily check that each verified domain added by
 * name still holds its ownership record (see domain-ownership-watch.ts).
 * Schedule and retry policy live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { watchDomainOwnership } from './domain-ownership-watch'

const log = logger.child({ component: 'domain-ownership-watch' })

export async function runDomainOwnershipWatch(): Promise<void> {
  const result = await watchDomainOwnership()
  if (result.checked > 0) {
    log.debug(result, 'domain ownership watch complete')
  }
}
