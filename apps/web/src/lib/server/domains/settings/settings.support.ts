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
 * Whether conversations are reachable from ANY visitor surface (widget messenger or
 * portal Support tab). The shared visitor-facing conversation paths gate on this, so
 * disabling the widget no longer kills the portal surface and vice versa.
 */
export async function isConversationsEnabled(): Promise<boolean> {
  const { isMessengerEnabled } = await import('./settings.widget')
  const [widget, portal] = await Promise.all([isMessengerEnabled(), isPortalSupportEnabled()])
  return widget || portal
}
