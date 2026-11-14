/**
 * What the domain pages share about a domain's uses: their order, which uses a
 * viewer may see, and the route of a domain's own page. Kept out of
 * `domains-permissions`, which route loaders read, so none of it rides in the
 * app entry.
 */
import { DOMAIN_USE_PERMISSION, type DomainUse } from './domains-permissions'

/** A domain's own page, which shows every use it has. */
export const DOMAIN_VIEW_ROUTE = '/admin/settings/domains/$domain'

/** The uses in the order every page lists them. */
export const DOMAIN_USE_ORDER: readonly DomainUse[] = ['email', 'customDomain', 'signIn']

/** The uses of a domain this viewer may see, in order. */
export function visibleDomainUses(permissions: readonly string[]): DomainUse[] {
  return DOMAIN_USE_ORDER.filter((use) => permissions.includes(DOMAIN_USE_PERMISSION[use]))
}
