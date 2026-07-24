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
  // Sequential short-circuit, deliberately not Promise.all: the flags read
  // from one per-request-cached settings row, so there is nothing to win by
  // racing — and concurrent dynamic imports of the same module resolve
  // unreliably under the test runner's mock interceptor.
  const { isMessengerEnabled } = await import('./settings.widget')
  if (await isMessengerEnabled()) return true
  if (await isPortalSupportEnabled()) return true
  return isSupportTicketsEnabled()
}

/**
 * Whether the support-tickets surface is enabled (the `supportTickets` feature
 * flag). Fail-closed. Gates customer ticket creation and the portal Tickets surface.
 */
export async function isSupportTicketsEnabled(): Promise<boolean> {
  const { isFeatureEnabled } = await import('./settings.service')
  return isFeatureEnabled('supportTickets')
}
