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

export type PortalNavItem =
  | (typeof NAV_ITEMS_BASE)[number]
  | typeof NAV_ITEM_CHANGELOG
  | typeof NAV_ITEM_HELP
  | typeof NAV_ITEM_SUPPORT

/**
 * Returns the nav items shown in the portal header.
 * Feedback/roadmap are always shown; Changelog appears unless the admin
 * turned off its portal nav tab (Settings > Changelog > Visibility — default
 * on, so a workspace that never customized it keeps today's behavior). A
 * Help tab is appended when the help center feature is enabled, and a
 * Support tab (the signed-in user's conversations) when portal support is
 * enabled.
 */
export function buildNavItems({
  helpCenterEnabled,
  supportEnabled,
  changelogEnabled = true,
}: {
  helpCenterEnabled: boolean
  supportEnabled: boolean
  changelogEnabled?: boolean
}): readonly PortalNavItem[] {
  const items: PortalNavItem[] = [...NAV_ITEMS_BASE]
  if (changelogEnabled) items.push(NAV_ITEM_CHANGELOG)
  if (helpCenterEnabled) items.push(NAV_ITEM_HELP)
  if (supportEnabled) items.push(NAV_ITEM_SUPPORT)
  return items
}
