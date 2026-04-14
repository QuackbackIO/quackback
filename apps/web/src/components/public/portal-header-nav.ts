/**
 * Pure helpers for the portal header's top-level nav.
 * Kept in its own module so tests can import without dragging in React.
 */

const NAV_ITEMS_BASE = [
  { to: '/', messageId: 'portal.header.nav.feedback', defaultMessage: 'Feedback' },
  { to: '/roadmap', messageId: 'portal.header.nav.roadmap', defaultMessage: 'Roadmap' },
  { to: '/changelog', messageId: 'portal.header.nav.changelog', defaultMessage: 'Changelog' },
] as const

const NAV_ITEM_HELP = {
  to: '/hc',
  messageId: 'portal.header.nav.help',
  defaultMessage: 'Help Center',
} as const

export type PortalNavItem = (typeof NAV_ITEMS_BASE)[number] | typeof NAV_ITEM_HELP

/**
 * Returns the nav items shown in the portal header.
 * On the help center subdomain we show only the Help tab so the standalone
 * experience stays focused. Elsewhere we show feedback/roadmap/changelog and
 * append a Help tab when the help center is enabled.
 */
export function buildNavItems({
  helpCenterEnabled,
  helpCenterHost,
}: {
  helpCenterEnabled: boolean
  helpCenterHost: boolean
}): readonly PortalNavItem[] {
  if (helpCenterHost) {
    return helpCenterEnabled ? [NAV_ITEM_HELP] : []
  }
  if (helpCenterEnabled) {
    return [...NAV_ITEMS_BASE, NAV_ITEM_HELP]
  }
  return NAV_ITEMS_BASE
}
