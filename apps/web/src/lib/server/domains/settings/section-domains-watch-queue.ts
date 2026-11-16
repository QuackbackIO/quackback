/**
 * Section domain watch: the daily re-check that each verified section hostname
 * on a self-hosted server still reaches it (see section-domains-watch.ts).
 * Schedule and retry policy live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { watchSectionDomains } from './section-domains-watch'

const log = logger.child({ component: 'section-domains-watch' })

export async function runSectionDomainsWatch(): Promise<void> {
  const result = await watchSectionDomains()
  if (result.checked > 0) {
    log.debug(result, 'section domain watch complete')
  }
}
