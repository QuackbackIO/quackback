/**
 * Pure helpers for the portal header's top-level nav.
 * Kept in its own module so tests can import without dragging in React.
 */

const NAV_ITEMS_BASE = [
  { to: '/', messageId: 'portal.header.nav.feedback', defaultMessage: 'Feedback' },
  { to: '/roadmap', messageId: 'portal.header.nav.roadmap', defaultMessage: 'Roadmap' },
  { to: '/changelog', messageId: 'portal.header.nav.changelog', defaultMessage: 'Changelog' },
] as const

const NAV_ITEM_TICKETS = {
  to: '/tickets',
  messageId: 'portal.header.nav.tickets',
  defaultMessage: 'My tickets',
} as const

const NAV_ITEM_HELP = {
  to: '/hc',
  messageId: 'portal.header.nav.help',
  defaultMessage: 'Help Center',
} as const

const NAV_ITEM_SUPPORT = {
  to: '/support',
  messageId: 'portal.header.nav.support',
  defaultMessage: 'Support',
} as const

export type PortalNavItem =
  | (typeof NAV_ITEMS_BASE)[number]
  | typeof NAV_ITEM_TICKETS
  | typeof NAV_ITEM_HELP
  | typeof NAV_ITEM_SUPPORT

export type PortalTabConfig = {
  feedback?: boolean
  roadmap?: boolean
  changelog?: boolean
  myTickets?: boolean
  helpCenter?: boolean
  support?: boolean
}

/**
 * Returns the nav items shown in the portal header.
 * - Feedback / Roadmap / Changelog are always shown (unless disabled in enabledTabs).
 * - "My tickets" is appended for signed-in users if enabled (between base + help).
 * - Help Center is appended when the workspace has the feature on AND it's enabled in tabs.
 * - Support (live-chat conversations) is appended when portal support is enabled AND it's enabled in tabs.
 *
 * The enabledTabs config allows fine-grained control over which tabs are visible.
 * Defaults to all tabs enabled if not provided.
 */
export function buildNavItems({
  helpCenterEnabled,
  isSignedIn = false,
  supportEnabled = false,
  enabledTabs = {},
}: {
  helpCenterEnabled: boolean
  isSignedIn?: boolean
  supportEnabled?: boolean
  enabledTabs?: PortalTabConfig
}): readonly PortalNavItem[] {
  const tabs = {
    feedback: enabledTabs.feedback !== false,
    roadmap: enabledTabs.roadmap !== false,
    changelog: enabledTabs.changelog !== false,
    myTickets: enabledTabs.myTickets !== false,
    helpCenter: enabledTabs.helpCenter !== false,
    support: enabledTabs.support !== false,
  }

  const items: PortalNavItem[] = []

  if (tabs.feedback) items.push(NAV_ITEMS_BASE[0]!)
  if (tabs.roadmap) items.push(NAV_ITEMS_BASE[1]!)
  if (tabs.changelog) items.push(NAV_ITEMS_BASE[2]!)

  if (isSignedIn && tabs.myTickets) items.push(NAV_ITEM_TICKETS)
  if (helpCenterEnabled && tabs.helpCenter) items.push(NAV_ITEM_HELP)
  if (supportEnabled && tabs.support) items.push(NAV_ITEM_SUPPORT)

  return items
}
