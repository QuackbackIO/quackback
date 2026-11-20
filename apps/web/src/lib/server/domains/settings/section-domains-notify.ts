/**
 * Telling the people who may set a section's domain when the section domain
 * watch (`section-domains-watch.ts`) finds one no longer reaching this server:
 * a warning with the date it has to be fixed by, and a notice when it stops
 * being verified.
 *
 * Recipients are every teammate holding `settings.custom_domain`, the
 * permission Verify is gated on. A bell for each, respecting their in-app
 * preference, as the same "domain needs attention" type a domain added by name
 * uses. The bell names its section, so it opens the Custom domains tab of
 * Settings > Portal. A failure here is logged and never undoes what it reports.
 */
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { usedForLabel, type PortalSection } from '@/lib/shared/custom-domains'
import {
  formatDeadline,
  managersHolding,
  ringManagers,
} from '@/lib/server/domains/channel-accounts/sending-domain-notify'

const log = logger.child({ component: 'section-domains-notify' })

async function ring(
  section: PortalSection,
  hostname: string,
  title: string,
  body: string
): Promise<void> {
  try {
    const managers = await managersHolding(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
    if (managers.length === 0) return
    await ringManagers(managers, 'domain_needs_attention', {
      title,
      body,
      metadata: { domain: hostname, audience: 'admin', section },
    })
  } catch (err) {
    log.warn({ err, hostname }, 'section domain notification failed')
  }
}

/**
 * Why a hostname was marked: its DNS (no address, or something else answers),
 * or the verification record that covered it.
 */
export type SectionDomainMarkReason = 'dns' | 'record'

/**
 * The hostname was marked; it stays verified until `deadline`. Worded as the
 * Custom domains card words it, naming the real fix: DNS only when DNS is
 * what is wrong, otherwise verifying its domain.
 */
export async function notifySectionDomainNotAnswering(
  section: PortalSection,
  hostname: string,
  deadline: Date,
  reason: SectionDomainMarkReason
): Promise<void> {
  const label = usedForLabel(section)
  const by = formatDeadline(deadline)
  await ring(
    section,
    hostname,
    `${hostname} needs attention`,
    reason === 'record'
      ? `Domain verification failed for the ${label} domain. Verify its domain in Settings > Domains by ${by} to keep it.`
      : `The ${label} domain is not answering. Fix its DNS by ${by} to keep it verified.`
  )
}

/** The hostname still did not reach this server when its grace ran out: its section is back on the primary domain. */
export async function notifySectionDomainLapsed(
  section: PortalSection,
  hostname: string,
  reason: SectionDomainMarkReason
): Promise<void> {
  const fix = reason === 'record' ? 'Verify its domain in Settings > Domains' : 'Fix the DNS'
  await ring(
    section,
    hostname,
    `${hostname} is no longer verified`,
    `${usedForLabel(section)} is back on the primary domain. ${fix}, then verify it again.`
  )
}
