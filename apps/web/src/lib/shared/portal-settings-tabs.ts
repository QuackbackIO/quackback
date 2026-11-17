/**
 * Settings > Portal is one settings row with two tabs: Design (the
 * portal's look, tabs and welcome message, saved from the page's save bar) and
 * Custom domains (where each section's domain is set, saved from its own
 * dialog). Each tab opens to the permission that owns it, so the page opens to
 * a holder of either. Pure and client-safe: the route, the nav, the links to
 * the tab and the old Domains anchor read it.
 */
import { PERMISSIONS, type PermissionKey } from './permissions'
import { CUSTOM_DOMAINS_ANCHOR } from './section-domains'

export const PORTAL_SETTINGS_PATH = '/admin/settings/portal'

export const PORTAL_TABS = ['design', 'custom-domains'] as const
export type PortalTab = (typeof PORTAL_TABS)[number]

export const PORTAL_TAB_LABELS: Record<PortalTab, string> = {
  design: 'Design',
  'custom-domains': 'Custom domains',
}

/** The permission each tab's reads and writes are gated on. */
const TAB_PERMISSION: Record<PortalTab, PermissionKey> = {
  design: PERMISSIONS.SETTINGS_BRANDING,
  'custom-domains': PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
}

/** Who can open Settings > Portal: a holder of either tab's permission. */
export const PORTAL_PAGE_PERMISSIONS = [
  TAB_PERMISSION.design,
  TAB_PERMISSION['custom-domains'],
] as const satisfies readonly PermissionKey[]

/** The tabs this viewer has, in order. */
export function portalTabsFor(permissions: readonly string[] | undefined): PortalTab[] {
  return PORTAL_TABS.filter((tab) => permissions?.includes(TAB_PERMISSION[tab]) ?? false)
}

/** The tab asked for when the viewer has it; otherwise their first. */
export function resolvePortalTab(
  requested: PortalTab | undefined,
  tabs: readonly PortalTab[]
): PortalTab {
  if (requested && tabs.includes(requested)) return requested
  return tabs[0] ?? 'design'
}

/** Where custom domains are set: the Custom domains tab of Settings > Portal. */
export const CUSTOM_DOMAINS_LINK = {
  to: PORTAL_SETTINGS_PATH,
  search: { tab: 'custom-domains' },
} as const satisfies { to: string; search: { tab: PortalTab } }

/** The same place as one URL, for a server-made link (a bell, the MCP navigation tool). */
export const CUSTOM_DOMAINS_HREF = `${CUSTOM_DOMAINS_LINK.to}?${new URLSearchParams(CUSTOM_DOMAINS_LINK.search)}`

/**
 * Custom domains used to be a card on Settings > Domains, linked as
 * /admin/settings/domains#custom-domains. A hash never reaches the server, so
 * the Domains page sends that anchor on from the browser, to a viewer who can
 * open the tab.
 */
export function legacyCustomDomainsTarget(
  hash: string,
  permissions: readonly string[] | undefined
): typeof CUSTOM_DOMAINS_LINK | null {
  if (hash !== `#${CUSTOM_DOMAINS_ANCHOR}`) return null
  return portalTabsFor(permissions).includes('custom-domains') ? CUSTOM_DOMAINS_LINK : null
}
