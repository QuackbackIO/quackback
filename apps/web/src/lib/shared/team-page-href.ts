/**
 * Where a portal link to one of the team's pages points. Kept apart from
 * section-links.ts, which the entry chunk carries: only the portal's team
 * links need this, and a new export there renames the entry chunk's exports
 * for every page.
 */
import type { SectionOrigins } from './section-links'

/**
 * A link to one of the team's pages (/admin and the like), which run on the
 * primary domain only, from a page on `links.hostOrigin`: the absolute address
 * on the primary domain when the page is on a section host, else null, and
 * the page links it as usual. Never through the sign-in handoff: a carried
 * session is portal scope and could not open the admin.
 */
export function teamPageHref(
  path: string,
  links: { origins: SectionOrigins; hostOrigin: string } | null
): string | null {
  if (!links || links.hostOrigin === links.origins.primary) return null
  return `${links.origins.primary}${path}`
}
