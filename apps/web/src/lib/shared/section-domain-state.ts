/**
 * Where one section's hostname stands, as the admin pages name it. Client-safe
 * and pure, so the Domains list, the Custom domains card and the product pages
 * read the same words from the same entry.
 */
import type { SectionDomain } from './section-domains'

export type SectionDomainState = 'verified' | 'pending' | 'not-answering'

/**
 * Verified once it reaches this server; pending until then. A verification
 * kept while the hostname's lookups go unanswered (self-hosted) is "not
 * answering", whether or not its grace has run out.
 */
export function sectionDomainState(entry: SectionDomain): SectionDomainState {
  if (entry.unconfirmedSince) return 'not-answering'
  return entry.verifiedAt ? 'verified' : 'pending'
}
