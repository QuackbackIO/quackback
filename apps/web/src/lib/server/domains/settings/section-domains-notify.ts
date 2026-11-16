/**
 * Telling the people who may set a section's domain when the section domain
 * watch (`section-domains-watch.ts`) finds one no longer reaching this server:
 * a warning with the date it has to be fixed by, and a notice when it stops
 * being verified.
 *
 * Recipients are every teammate holding `settings.custom_domain`, the
 * permission Verify is gated on. A bell for each, respecting their in-app
 * preference, as the same "domain needs attention" type a domain added by name
 * uses, so it opens Settings > Domains. A failure here is logged and never
 * undoes what it reports.
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

async function ring(hostname: string, title: string, body: string): Promise<void> {
  try {
    const managers = await managersHolding(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
    if (managers.length === 0) return
    await ringManagers(managers, 'domain_needs_attention', {
      title,
      body,
      metadata: { domain: hostname, audience: 'admin' },
    })
  } catch (err) {
    log.warn({ err, hostname }, 'section domain notification failed')
  }
}

/**
 * The hostname stopped reaching this server; it stays verified until
 * `deadline`. Worded as the Custom domains card words it: Needs attention, Not
 * answering, and the date.
 */
export async function notifySectionDomainNotAnswering(
  section: PortalSection,
  hostname: string,
  deadline: Date
): Promise<void> {
  await ring(
    hostname,
    `${hostname} needs attention`,
    `The ${usedForLabel(section)} domain is not answering. Fix its DNS by ${formatDeadline(deadline)} to keep it verified.`
  )
}

/** The hostname still did not reach this server when its grace ran out: its section is back on the primary domain. */
export async function notifySectionDomainLapsed(
  section: PortalSection,
  hostname: string
): Promise<void> {
  await ring(
    hostname,
    `${hostname} is no longer verified`,
    `${usedForLabel(section)} is back on the primary domain. Fix the DNS, then verify it again.`
  )
}
