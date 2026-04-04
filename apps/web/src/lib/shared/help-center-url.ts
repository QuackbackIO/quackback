/**
 * Build the base URL for the standalone help center.
 *
 * Priority:
 * 1. Verified custom domain -> https://{customDomain}
 * 2. Convention subdomain   -> https://help.{slug}.quackback.app
 * 3. Fallback               -> /help (relative, for edge cases)
 */
export function getHelpCenterBaseUrl(
  settings: {
    helpCenterConfig?: { customDomain?: string | null; domainVerified?: boolean } | null
    slug?: string | null
  } | null
): string {
  const config = settings?.helpCenterConfig
  if (config?.customDomain && config.domainVerified) {
    return `https://${config.customDomain}`
  }
  const slug = settings?.slug
  if (slug) {
    return `https://help.${slug}.quackback.app`
  }
  return '/help' // fallback for edge cases
}
