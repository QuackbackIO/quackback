/**
 * Support-surface gates. `isMessengerEnabled` (settings.widget.ts) keeps gating
 * the widget messenger surface; these compose it with the portal Support tab so the
 * shared conversation paths (visitor send/read, SSE stream, inbound email)
 * stay alive when either surface is on.
 */

/**
 * Whether the portal Support tab is enabled: the experimental `supportInbox`
 * feature flag AND the explicit portal toggle. Fail-closed — an absent
 * `support` section means disabled, so existing workspaces are unaffected.
 */
export async function isPortalSupportEnabled(): Promise<boolean> {
  const { isFeatureEnabled, getPortalConfig } = await import('./settings.service')
  const [flagOn, portal] = await Promise.all([isFeatureEnabled('supportInbox'), getPortalConfig()])
  return Boolean(flagOn && portal.support?.enabled === true)
}

/**
 * Whether conversations are reachable from ANY visitor surface (widget
 * messenger, portal Support tab, or the converged Messages surface of a
 * tickets-enabled workspace). The shared visitor-facing conversation paths
 * gate on this, so disabling the widget no longer kills the portal surface and
 * vice versa. Tickets count because every customer ticket IS a conversation
 * pair — an email-first workspace with the messenger off still lists and
 * replies to its ticket threads through Messages.
 */
export async function isConversationsEnabled(): Promise<boolean> {
  const { isMessengerEnabled } = await import('./settings.widget')
  const [widget, portal, tickets] = await Promise.all([
    isMessengerEnabled(),
    isPortalSupportEnabled(),
    isSupportTicketsEnabled(),
  ])
  return widget || portal || tickets
}

/**
 * Whether the support-tickets surface is enabled (the `supportTickets` feature
 * flag). Fail-closed. Gates customer ticket creation and the portal Tickets surface.
 */
export async function isSupportTicketsEnabled(): Promise<boolean> {
  const { isFeatureEnabled } = await import('./settings.service')
  return isFeatureEnabled('supportTickets')
}

/**
 * Whether the widget Tickets tab is enabled: the experimental `supportTickets`
 * feature flag AND the widget master switch AND the explicit `tabs.tickets`
 * toggle. Fail-closed. This is the single choke point every widget-facing
 * ticket path consults (list, read, create, reply), so flipping the flag or the
 * toggle off fails them all closed — the messenger `isMessengerEnabled` analog.
 */
export async function isWidgetTicketsEnabled(): Promise<boolean> {
  const { isFeatureEnabled } = await import('./settings.service')
  const { getWidgetConfig } = await import('./settings.widget')
  const [flagOn, widget] = await Promise.all([
    isFeatureEnabled('supportTickets'),
    getWidgetConfig(),
  ])
  return Boolean(flagOn && widget.enabled && widget.tabs?.tickets)
}
