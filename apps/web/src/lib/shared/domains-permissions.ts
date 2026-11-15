import { PERMISSIONS, type PermissionKey } from './permissions'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'

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

/** The Custom domains card on this page (Cloud), where the empty state's Custom domain action lands. */
export const CUSTOM_DOMAINS_ANCHOR = 'custom-domains'

export const HELP_CENTER_SETTINGS = '/admin/settings/help-center'

export interface UseLink {
  to: string
  search?: Record<string, string>
  hash?: string
}

/** Where each use is set up, for the uses this viewer may set up. */
export type DomainUseLinks = Partial<Record<DomainUse, UseLink>>

/**
 * The setup page for each use, gated by that page's own permission. Email and
 * Sign-in sit behind no product. Custom domains on Cloud are set up on this
 * page; on an install that serves its help center itself, the only domain it
 * takes is the help center's, set on Help center settings.
 */
export function domainUseLinks({
  permissions,
  cloudEnabled,
  helpCenterOn,
}: {
  permissions: readonly string[]
  cloudEnabled: boolean
  helpCenterOn: boolean
}): DomainUseLinks {
  const can = (permission: string) => permissions.includes(permission)
  const links: DomainUseLinks = {}
  if (can(EMAIL_SENDING_PERMISSION)) links.email = { to: '/admin/settings/email' }
  if (can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)) {
    if (cloudEnabled) {
      links.customDomain = { to: '/admin/settings/domains', hash: CUSTOM_DOMAINS_ANCHOR }
    } else if (helpCenterOn && can(PERMISSIONS.HELP_CENTER_MANAGE)) {
      // For now a self-hosted help center domain is written on Help center
      // settings, behind help center access too. When custom domains are set
      // per section, every write moves to Settings > Domains behind
      // settings.custom_domain alone, on Cloud and self-hosted, and this
      // link goes to the Custom domains card like Cloud's. Product pages then
      // show their custom domain read-only, with a link here.
      links.customDomain = {
        to: HELP_CENTER_SETTINGS,
        search: { tab: 'domains-languages' },
      }
    }
  }
  if (can(PERMISSIONS.AUTH_MANAGE)) {
    links.signIn = { to: '/admin/settings/security/authentication', search: { tab: 'sign-in' } }
  }
  return links
}
