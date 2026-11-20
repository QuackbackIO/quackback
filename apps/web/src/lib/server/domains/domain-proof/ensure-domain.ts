/**
 * Putting a domain on Settings > Domains after a use was given it in context
 * (a sign-in domain, the help center's domain, a Cloud web address).
 *
 * The use's own write has already committed by then, so this never fails it:
 * an error is logged and the domain is left for the next time the name is
 * given a use, or for a person to add it by name. Callers run it after their
 * own cache and sign-in resets, so those always happen.
 */
import { logger } from '@/lib/server/logger'
import { coveringName } from '@/lib/shared/custom-domains'
import { ensureDomain, listDomains } from './domains.service'

const log = logger.child({ component: 'domains' })

export async function ensureDomainAfterUse(name: string): Promise<void> {
  try {
    await ensureDomain(name)
  } catch (err) {
    log.warn({ err, domain: name }, 'could not put a domain given a use on Settings > Domains')
  }
}

/**
 * The same for a custom domain (the help center's domain, a Cloud custom
 * domain): one under a domain already added belongs to that domain and is
 * listed on its page, so it gets no domain of its own.
 */
export async function ensureDomainForCustomDomain(hostname: string): Promise<void> {
  try {
    const names = (await listDomains()).map((d) => d.name)
    if (coveringName(hostname, names)) return
  } catch (err) {
    log.warn({ err, domain: hostname }, 'could not read the added domains for a custom domain')
    return
  }
  await ensureDomainAfterUse(hostname)
}
