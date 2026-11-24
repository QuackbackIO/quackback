import { PERMISSIONS, type PermissionKey } from './permissions'
import { EMAIL_SENDING_PERMISSION } from './email-sending-permissions'
import { CUSTOM_DOMAINS_LINK } from './portal-settings-tabs'
import type { PortalSection } from './custom-domains'

export type DomainUse = 'email' | 'customDomain' | 'signIn'

/** The permission that owns each use of a domain: its holder may read that use. */
export const DOMAIN_USE_PERMISSION = {
  email: EMAIL_SENDING_PERMISSION,
  customDomain: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  signIn: PERMISSIONS.AUTH_MANAGE,
} as const satisfies Record<DomainUse, PermissionKey>

/**
 * Who can open the Domains page: a holder of any permission that owns one of
 * the kinds of domain it lists (custom domains, email sending, sign-in).
 * Kept apart from the settings nav so a route loader can read it without
 * pulling the page registry into the app entry.
 */
export const DOMAINS_PAGE_PERMISSIONS = [
  DOMAIN_USE_PERMISSION.customDomain,
  DOMAIN_USE_PERMISSION.email,
  DOMAIN_USE_PERMISSION.signIn,
] as const satisfies readonly PermissionKey[]

/** Every portal section, by name; checked complete here so this module stays free of section logic. */
const SECTION_NAMES: Record<PortalSection, true> = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** What Settings > Domains reads from its URL. */
export interface DomainsPageSearch {
  /** `1` opens Add domain on arrival. */
  add?: '1'
  /** The portal section that asked for a domain; read, not yet acted on. */
  for?: PortalSection
}

/**
 * Settings > Domains with its Add domain dialog open, for a viewer who holds
 * settings.manage, naming the section that asked when there is one.
 */
export function addDomainLink(section?: PortalSection): {
  to: '/admin/settings/domains'
  search: DomainsPageSearch
} {
  return {
    to: '/admin/settings/domains',
    search: section ? { add: '1', for: section } : { add: '1' },
  }
}

/** Whether a Domains page URL asks for Add domain open (`?add=1`, read as a number or a string). */
export function opensAddDomain(search: { add?: unknown }): boolean {
  return search.add === '1' || search.add === 1
}

/** The Domains page's search, keeping only values it understands. */
export function domainsPageSearch(search: Record<string, unknown>): DomainsPageSearch {
  const out: DomainsPageSearch = {}
  if (opensAddDomain(search)) out.add = '1'
  const section = search.for
  if (typeof section === 'string' && Object.hasOwn(SECTION_NAMES, section)) {
    out.for = section as PortalSection
  }
  return out
}

/** The Cloud card, on the Custom domains tab, where a hostname is added and its DNS records are checked. */
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
 * domains tab of Settings > Portal, on Cloud and self-hosted alike; product
 * pages show their section's domain read-only, with a link there.
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
    links.customDomain = { to: CUSTOM_DOMAINS_LINK.to, search: { ...CUSTOM_DOMAINS_LINK.search } }
  }
  if (can(PERMISSIONS.AUTH_MANAGE)) {
    links.signIn = { to: '/admin/settings/security/authentication', search: { tab: 'sign-in' } }
  }
  return links
}
