/**
 * Section domain watch: the daily re-check that each verified section hostname
 * on a self-hosted server still reaches it (see section-domains-watch.ts).
 * Schedule and retry policy live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { PORTAL_SECTIONS } from '@/lib/shared/section-domains'
import { watchSectionDomains } from './section-domains-watch'
import { getSectionDomains, readHostingIfSetUp } from './section-domains.service'

const log = logger.child({ component: 'section-domains-watch' })

/**
 * The schedule's gate: open only on a self-hosted server that is set up and
 * has a verified section hostname to check. Shut on Cloud, where the control
 * plane decides when a domain is ready, so no workspace there gets a daily
 * job that does nothing. The handler makes the same checks, for a run that
 * reaches it some other way.
 */
export async function isSectionDomainsWatchDue(): Promise<boolean> {
  const hosting = await readHostingIfSetUp()
  if (!hosting || hosting.cloud) return false
  const map = await getSectionDomains('fresh')
  return PORTAL_SECTIONS.some((section) => !!map[section]?.verifiedAt)
}

export async function runSectionDomainsWatch(): Promise<void> {
  const result = await watchSectionDomains()
  if (result.checked > 0) {
    log.debug(result, 'section domain watch complete')
  }
}
