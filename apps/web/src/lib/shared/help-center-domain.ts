/**
 * Pure host-matching helpers for the help center custom domain (domains/
 * languages §1). Client-safe: route files evaluate the default-host ->
 * custom-domain 301 in beforeLoad, which is client-bundled, so these must not
 * pull the server-only domain service (settings/redis/db) into that graph.
 * The service re-exports them for server callers.
 */
import type { HelpCenterDomainConfig } from '@/lib/shared/types/settings'

/**
 * Full-coverage 301: once a domain is verified, every /hc/* request on the
 * default host redirects to the same path on the custom domain. Pure so the
 * router layer (which owns the actual request Host) can unit test it without
 * a live request. Returns null when no redirect is needed.
 */
export function resolveHelpCenterDomainRedirect(params: {
  domainConfig: HelpCenterDomainConfig | null | undefined
  currentHost: string | null
  pathname: string
  search: string
}): string | null {
  const { domainConfig, currentHost, pathname, search } = params
  if (!domainConfig?.domain || !domainConfig?.verifiedAt) return null
  if (!currentHost) return null

  const host = currentHost.split(':')[0]?.toLowerCase()
  const target = domainConfig.domain.toLowerCase()
  if (!host || host === target) return null

  return `https://${target}${pathname}${search}`
}

/**
 * Canonical-URL base for the current request: the verified custom domain
 * when the request actually arrived on it, else the fallback (global
 * BASE_URL). Pure for the same reason as {@link resolveHelpCenterDomainRedirect}.
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
