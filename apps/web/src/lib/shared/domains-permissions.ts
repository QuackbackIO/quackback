import { PERMISSIONS, type PermissionKey } from './permissions'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'
import { CUSTOM_DOMAINS_ANCHOR } from './section-domains'

export type DomainUse = 'email' | 'customDomain' | 'signIn'

/** The permission that owns each use of a domain: its holder may read that use. */
export const DOMAIN_USE_PERMISSION = {
  email: EMAIL_SENDING_PERMISSION,
  customDomain: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  signIn: PERMISSIONS.AUTH_MANAGE,
} as const satisfies Record<DomainUse, PermissionKey>

/**
 * Who can open the Domains page: a holder of any permission that owns one of
 * the kinds of domain it lists (web addresses, email sending, sign-in).
 * Kept apart from the settings nav so a route loader can read it without
 * pulling the page registry into the app entry.
 */
export const DOMAINS_PAGE_PERMISSIONS = [
  DOMAIN_USE_PERMISSION.customDomain,
  DOMAIN_USE_PERMISSION.email,
  DOMAIN_USE_PERMISSION.signIn,
] as const satisfies readonly PermissionKey[]

/** The Custom domains card on the Domains page, where each section's domain is set. */
export { CUSTOM_DOMAINS_ANCHOR }

/** The Cloud card where a hostname is added and its DNS records are checked. */
export const DOMAIN_VERIFICATION_ANCHOR = 'domain-verification'

export interface UseLink {
  to: string
  search?: Record<string, string>
  hash?: string
}

/** Where each use is set up, for the uses this viewer may set up. */
export type DomainUseLinks = Partial<Record<DomainUse, UseLink>>

/**
 * The setup page for each use, gated by that page's own permission. Email and
 * Sign-in sit behind no product. Custom domains are set up on the Custom
 * domains card of this page, on Cloud and self-hosted alike; product pages
 * show their section's domain read-only, with a link here.
 */
export function domainUseLinks({
  permissions,
}: {
  permissions: readonly string[]
}): DomainUseLinks {
  const can = (permission: string) => permissions.includes(permission)
  const links: DomainUseLinks = {}
  if (can(EMAIL_SENDING_PERMISSION)) links.email = { to: '/admin/settings/email' }
  if (can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)) {
    links.customDomain = { to: '/admin/settings/domains', hash: CUSTOM_DOMAINS_ANCHOR }
  }
  if (can(PERMISSIONS.AUTH_MANAGE)) {
    links.signIn = { to: '/admin/settings/security/authentication', search: { tab: 'sign-in' } }
  }
  return links
}
