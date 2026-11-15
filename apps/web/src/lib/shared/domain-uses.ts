/**
 * What the domain pages share about a domain's uses: their order, the
 * permission that owns each, and the route of a domain's own page. Kept out
 * of `domains-permissions`, which route loaders read, so none of it rides in
 * the app entry.
 */
import { PERMISSIONS, type PermissionKey } from './permissions'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'
import type { DomainUse } from './domains-permissions'

/** A domain's own page, which shows every use it has. */
export const DOMAIN_VIEW_ROUTE = '/admin/settings/domains/$domain'

/** The uses in the order every page lists them. */
export const DOMAIN_USE_ORDER: readonly DomainUse[] = ['email', 'customDomain', 'signIn']

/** The permission that owns each use: its holder may read that use of a domain. */
const DOMAIN_USE_PERMISSION = {
  email: EMAIL_SENDING_PERMISSION,
  customDomain: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  signIn: PERMISSIONS.AUTH_MANAGE,
} as const satisfies Record<DomainUse, PermissionKey>

/** The uses of a domain this viewer may see, in order. */
export function visibleDomainUses(permissions: readonly string[]): DomainUse[] {
  return DOMAIN_USE_ORDER.filter((use) => permissions.includes(DOMAIN_USE_PERMISSION[use]))
}
