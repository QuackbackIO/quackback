/**
 * Custom domains: the hostnames people reach the portal at, and what each one
 * is used for. Today a Cloud custom domain is used for the whole portal and a
 * self-hosted server's one custom domain for its help center. The sections are
 * the portal nav's own, so a custom domain can later serve one section.
 */
import type { PortalNavItemType } from './types/settings'

/** A section of the portal: one of the nav's built-in tabs. */
export type PortalSection = Exclude<PortalNavItemType, 'link'>

/** What a custom domain is used for: one section, or the whole portal. */
export type CustomDomainUsedFor = PortalSection | 'portal'

const USED_FOR_LABEL: Record<CustomDomainUsedFor, string> = {
  portal: 'Portal',
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help center',
  support: 'Support',
  status: 'Status',
}

/** What a custom domain is used for, as the admin pages name it. */
export function usedForLabel(usedFor: CustomDomainUsedFor): string {
  return USED_FOR_LABEL[usedFor]
}

/**
 * The name among `names` that a hostname belongs to: the hostname itself, or
 * the closest name it sits under. `help.acme.com` belongs to `acme.com`;
 * `help.notacme.com` does not. Null when none covers it. Names are compared
 * lower-cased and without a trailing dot.
 */
export function coveringName(hostname: string, names: Iterable<string>): string | null {
  const clean = (n: string) => n.trim().toLowerCase().replace(/\.$/, '')
  const host = clean(hostname)
  let best: string | null = null
  for (const raw of names) {
    const name = clean(raw)
    if (!name) continue
    const covers = host === name || host.endsWith(`.${name}`)
    if (covers && (best === null || name.length > best.length)) best = name
  }
  return best
}
