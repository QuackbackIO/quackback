/**
 * The launch plan's brand step offers "Import from {domain}" when the
 * workspace's company website is known. This is that guess, from an email
 * address or a domain already recorded for the workspace. No guess shows the
 * website field instead, so every doubt here falls to asking.
 */
import { getEmailDomain, isPersonalEmailDomain } from '@/lib/server/personal-email-domains'
import { registrableDomain } from '@/lib/shared/registrable-domain'

/** Second-level labels universities sit under, below a country code (`ox.ac.uk`, `unimelb.edu.au`). */
const ACADEMIC_SECOND_LEVELS = new Set(['ac', 'edu'])

/** A university's or school's domain: someone signing up from one is rarely branding it. */
function isAcademicDomain(domain: string): boolean {
  const labels = domain.split('.')
  const tld = labels[labels.length - 1]!
  if (tld === 'edu') return true
  return (
    labels.length >= 3 && tld.length === 2 && ACADEMIC_SECOND_LEVELS.has(labels[labels.length - 2]!)
  )
}

/** The website to offer for a domain, or null when it is personal or academic. */
export function brandWebsiteOf(domain: string): string | null {
  const host = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || isPersonalEmailDomain(host) || isAcademicDomain(host)) return null
  return registrableDomain(host)
}

/** The company website behind an email address, or null when there is none to offer. */
export function brandWebsiteGuess(email: string): string | null {
  const domain = getEmailDomain(email)
  return domain ? brandWebsiteOf(domain) : null
}
