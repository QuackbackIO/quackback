/**
 * Pure helper for determining whether the current request is targeting
 * the standalone help center hostname.
 *
 * Kept in `lib/shared` so it can be tested without server dependencies.
 */

export function isHelpCenterHost(
  host: string,
  helpCenterConfig: {
    enabled: boolean
    customDomain: string | null
    domainVerified: boolean
  } | null,
  workspaceSlug: string | null,
  baseDomain: string
): boolean {
  if (!helpCenterConfig?.enabled) return false

  const hostname = host.split(':')[0] // Strip port

  // Check verified custom domain
  if (helpCenterConfig.customDomain && helpCenterConfig.domainVerified) {
    if (hostname === helpCenterConfig.customDomain) return true
  }

  // Check convention subdomain: help.{slug}.{baseDomain}
  if (workspaceSlug) {
    const expectedSubdomain = `help.${workspaceSlug}.${baseDomain}`
    if (hostname === expectedSubdomain) return true
  }

  return false
}
