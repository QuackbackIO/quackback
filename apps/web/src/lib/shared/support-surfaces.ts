/**
 * Visitor-facing support surface gates. Shared by the portal header, portal
 * Support routes, admin preview, and the async settings.support resolvers so
 * the formula cannot drift.
 */

/** Signed-in visitors can start a new portal conversation. */
export function isPortalChatStartEnabled(
  flags: { supportInbox?: boolean } | null | undefined,
  portal: { support?: { enabled?: boolean } } | null | undefined
): boolean {
  return Boolean(flags?.supportInbox && portal?.support?.enabled === true)
}

/**
 * Whether the portal Support tab (and its routes) are on: tickets-enabled
 * workspaces always list conversation pairs, otherwise the inbox flag plus
 * the explicit portal chats toggle.
 */
export function isPortalSupportSurfaceEnabled(
  flags: { supportTickets?: boolean; supportInbox?: boolean } | null | undefined,
  portal: { support?: { enabled?: boolean } } | null | undefined
): boolean {
  return Boolean(flags?.supportTickets || isPortalChatStartEnabled(flags, portal))
}

/**
 * Whether the widget Messages tab is live. Mirrors `isMessengerEnabled`
 * (`supportInbox` + widget master + Messages tab).
 */
export function isWidgetMessengerEnabled(
  flags: { supportInbox?: boolean } | null | undefined,
  widget: { enabled?: boolean; tabs?: { messenger?: boolean } } | null | undefined
): boolean {
  return Boolean(flags?.supportInbox && widget?.enabled && widget?.tabs?.messenger)
}
