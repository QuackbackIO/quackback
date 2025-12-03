/**
 * URL and subdomain routing utilities
 *
 * This module handles all URL building and subdomain parsing for multi-tenant routing.
 * Works consistently across all domains without special-case logic.
 *
 * Domain Structure:
 * - Main domain: example.com (apex domain)
 * - Tenant subdomains: acme.example.com
 */

// =============================================================================
// Subdomain Parsing
// =============================================================================

/**
 * Extract subdomain from host header
 *
 * example.com -> null (main domain)
 * acme.example.com -> acme (tenant)
 * www.example.com -> null (www treated as main)
 */
export function parseSubdomain(host: string): string | null {
  const hostWithoutPort = host.split(':')[0]
  const parts = hostWithoutPort.split('.')

  // Single-part hostname (e.g., "localhost") = main domain
  if (parts.length === 1) {
    return null
  }

  // Two-part hostname (e.g., "example.com" or "acme.localhost")
  if (parts.length === 2) {
    // If second part is a TLD-like suffix, it's apex domain
    // If second part is "localhost", first part is subdomain
    if (parts[1] === 'localhost') {
      return parts[0] === 'www' ? null : parts[0]
    }
    return null
  }

  // Three+ parts: first part is subdomain (unless www)
  if (parts[0] === 'www') {
    return null
  }
  return parts[0]
}

/**
 * Get the base domain from a hostname (strips subdomain)
 *
 * acme.example.com -> example.com
 * example.com -> example.com
 * acme.localhost -> localhost
 * localhost -> localhost
 */
export function getBaseDomain(host: string): string {
  const hostWithoutPort = host.split(':')[0]
  const port = host.includes(':') ? `:${host.split(':')[1]}` : ''
  const parts = hostWithoutPort.split('.')

  // Single-part: use as-is
  if (parts.length === 1) {
    return hostWithoutPort + port
  }

  // Two-part: if second is "localhost", return just "localhost"
  if (parts.length === 2 && parts[1] === 'localhost') {
    return 'localhost' + port
  }

  // Two-part apex domain or 3+ parts: return last 2 parts
  return parts.slice(-2).join('.') + port
}

// =============================================================================
// URL Building (Server-side - requires request context)
// =============================================================================

interface HostContext {
  host: string
  protocol?: string
}

/**
 * Get the main domain URL (without subdomain) from request context
 */
export function getMainDomainUrl(ctx: HostContext, path: string = '/'): string {
  const protocol = ctx.protocol || 'http'
  const baseDomain = getBaseDomain(ctx.host)
  return `${protocol}://${baseDomain}${path}`
}

/**
 * Build URL for a specific organization subdomain from request context
 */
export function getSubdomainUrl(ctx: HostContext, orgSlug: string, path: string = '/'): string {
  const protocol = ctx.protocol || 'http'
  const baseDomain = getBaseDomain(ctx.host)
  return `${protocol}://${orgSlug}.${baseDomain}${path}`
}

// =============================================================================
// URL Building (Client-side only - uses window.location)
// =============================================================================

/**
 * Build a URL for a specific organization subdomain (client-side only)
 */
export function buildOrgUrl(orgSlug: string, path: string = '/'): string {
  if (typeof window === 'undefined') {
    throw new Error('buildOrgUrl can only be called on the client')
  }

  const baseDomain = getBaseDomain(window.location.host)
  const protocol = window.location.protocol
  return `${protocol}//${orgSlug}.${baseDomain}${path}`
}

/**
 * Get the main domain URL (client-side only)
 */
export function buildMainDomainUrl(path: string = '/'): string {
  if (typeof window === 'undefined') {
    throw new Error('buildMainDomainUrl can only be called on the client')
  }

  const baseDomain = getBaseDomain(window.location.host)
  const protocol = window.location.protocol
  return `${protocol}//${baseDomain}${path}`
}
