/**
 * Pure helpers for the portal header's top-level nav.
 * Kept in its own module so tests can import without dragging in React.
 */

const NAV_ITEM_FEEDBACK = {
  to: '/',
  messageId: 'portal.header.nav.feedback',
  defaultMessage: 'Feedback',
} as const

const NAV_ITEM_ROADMAP = {
  to: '/roadmap',
  messageId: 'portal.header.nav.roadmap',
  defaultMessage: 'Roadmap',
} as const

const NAV_ITEM_CHANGELOG = {
  to: '/changelog',
  messageId: 'portal.header.nav.changelog',
  defaultMessage: 'Changelog',
} as const

const NAV_ITEMS_BASE = [NAV_ITEM_FEEDBACK, NAV_ITEM_ROADMAP] as const

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

const NAV_ITEM_STATUS = {
  to: '/status',
  messageId: 'portal.header.nav.status',
  defaultMessage: 'Status',
} as const

export type PortalNavItem =
  | (typeof NAV_ITEMS_BASE)[number]
  | typeof NAV_ITEM_CHANGELOG
  | typeof NAV_ITEM_HELP
  | typeof NAV_ITEM_SUPPORT
  | typeof NAV_ITEM_STATUS

/**
 * Returns the nav items shown in the portal header.
 * Feedback/roadmap are always shown; Changelog appears unless the admin
 * turned off its portal nav tab (Settings > Changelog > Visibility — default
 * on, so a workspace that never customized it keeps today's behavior). A
 * Help tab is appended when the help center feature is enabled, a Support
 * tab (the signed-in user's conversations) when portal support is enabled,
 * and a Status tab when the status page is enabled and its portal tab is on.
 * Enablement already folds in the viewer's audience gate, so the tab only
 * renders for a viewer who can see the page.
 */
export function buildNavItems({
  helpCenterEnabled,
  supportEnabled,
  changelogEnabled = true,
  statusEnabled = false,
}: {
  helpCenterEnabled: boolean
  supportEnabled: boolean
  changelogEnabled?: boolean
  statusEnabled?: boolean
}): readonly PortalNavItem[] {
  const items: PortalNavItem[] = [...NAV_ITEMS_BASE]
  if (changelogEnabled) items.push(NAV_ITEM_CHANGELOG)
  if (helpCenterEnabled) items.push(NAV_ITEM_HELP)
  if (supportEnabled) items.push(NAV_ITEM_SUPPORT)
  if (statusEnabled) items.push(NAV_ITEM_STATUS)
  return items
}
