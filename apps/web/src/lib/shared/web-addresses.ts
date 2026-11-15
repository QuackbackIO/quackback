/**
 * Web addresses: the hostnames people open the portal at, and what each one
 * opens. Today a Cloud web address opens the whole portal and a self-hosted
 * server's one address opens its help center. The sections are the portal
 * nav's own, so an address can later open one section of the portal.
 */
import type { PortalNavItemType } from './types/settings'

/** A section of the portal: one of the nav's built-in tabs. */
export type PortalSection = Exclude<PortalNavItemType, 'link'>

/** What a web address opens: one section, or the whole portal. */
export type WebAddressOpens = PortalSection | 'portal'

const OPENS_LABEL: Record<WebAddressOpens, string> = {
  portal: 'Whole portal',
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help center',
  support: 'Support',
  status: 'Status',
}

/** What an address opens, as the admin pages name it. */
export function opensLabel(opens: WebAddressOpens): string {
  return OPENS_LABEL[opens]
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
