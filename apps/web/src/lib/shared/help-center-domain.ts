/**
 * Pure host-matching helpers for the help center custom domain (domains/
 * languages §1). Client-safe, so they must not pull the server-only domain
 * service (settings/cache/db) into a client graph. The service re-exports them
 * for server callers. Sending the default host's /hc pages to the custom
 * domain is the section host middleware's job (middleware/section-host.ts).
 */
import type { HelpCenterDomainConfig } from '@/lib/shared/types/settings'

/**
 * The origin the help center's public URLs are served from: the verified custom
 * domain once one is verified, else the fallback. Unlike
 * {@link resolveHelpCenterBaseUrl} this ignores the request's host, for links
 * that name a help center URL wherever they are served.
 */
export function resolveHelpCenterPublicBaseUrl(params: {
  domainConfig: HelpCenterDomainConfig | null | undefined
  fallback: string
}): string {
  const { domainConfig, fallback } = params
  if (!domainConfig?.domain || !domainConfig?.verifiedAt) return fallback

  return `https://${domainConfig.domain}`
}

/**
 * Canonical-URL base for the current request: the verified custom domain
 * when the request actually arrived on it, else the fallback (global
 * BASE_URL). Pure, so it is unit tested without a live request.
 */
export function resolveHelpCenterBaseUrl(params: {
  domainConfig: HelpCenterDomainConfig | null | undefined
  currentHost: string | null
  fallback: string
}): string {
  const { domainConfig, currentHost, fallback } = params
  if (!domainConfig?.domain || !domainConfig?.verifiedAt || !currentHost) return fallback

  const host = currentHost.split(':')[0]?.toLowerCase()
  if (host !== domainConfig.domain.toLowerCase()) return fallback

  return `https://${domainConfig.domain}`
}
