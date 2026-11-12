import { PERMISSIONS, type PermissionKey } from './permissions'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'

/**
 * Who can open the Domains page: a holder of any permission that owns one of
 * the kinds of domain it lists (web addresses, email sending, sign-in).
 * Kept apart from the settings nav so a route loader can read it without
 * pulling the page registry into the app entry.
 */
export const DOMAINS_PAGE_PERMISSIONS = [
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  EMAIL_SENDING_PERMISSION,
  PERMISSIONS.AUTH_MANAGE,
] as const satisfies readonly PermissionKey[]

/** The Custom domains card on this page (Cloud), where the empty state's Custom domain action lands. */
export const CUSTOM_DOMAINS_ANCHOR = 'custom-domains'

export const HELP_CENTER_SETTINGS = '/admin/settings/help-center'

export type DomainUse = 'email' | 'customDomain' | 'signIn'

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
