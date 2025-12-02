/**
 * URL and subdomain routing utilities
 *
 * This module handles all URL building and subdomain parsing for multi-tenant routing.
 * Split into server-side and client-side compatible functions.
 */

// =============================================================================
// Configuration
// =============================================================================

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

// =============================================================================
// Subdomain Parsing (Server-side - used by proxy/middleware)
// =============================================================================

/**
 * Extract subdomain from host header
 * Handles: acme.quackback.com, acme.localhost:3000, acme.127.0.0.1.nip.io:3000
 */
export function parseSubdomain(host: string): string | null {
  const hostWithoutPort = host.split(':')[0]

  // localhost development: acme.localhost -> acme
  if (hostWithoutPort.endsWith('.localhost') || hostWithoutPort === 'localhost') {
    const parts = hostWithoutPort.split('.')
    if (parts.length > 1 && parts[0] !== 'www') {
      return parts[0]
    }
    return null
  }

  // nip.io development: acme.127.0.0.1.nip.io -> acme
  // Base domain is 6 parts (127.0.0.1.nip.io), subdomain adds 1
  if (hostWithoutPort.endsWith('.nip.io')) {
    const parts = hostWithoutPort.split('.')
    if (parts.length > 6 && parts[0] !== 'www') {
      return parts[0]
    }
    return null
  }

  // Production: acme.quackback.com -> acme
  const parts = hostWithoutPort.split('.')
  if (parts.length > 2 && parts[0] !== 'www') {
    return parts[0]
  }

  return null
}

// =============================================================================
// URL Building (Server-side - requires request context)
// =============================================================================

interface HostContext {
  host: string
  protocol?: string
}

/**
 * Parse host into components for URL building
 */
function parseHost(ctx: HostContext) {
  const protocol = ctx.protocol || 'http'
  const hostWithoutPort = ctx.host.split(':')[0]
  const port = ctx.host.includes(':') ? `:${ctx.host.split(':')[1]}` : ''

  return { protocol, hostWithoutPort, port }
}

/**
 * Get the main domain URL (without subdomain) from request context
 */
export function getMainDomainUrl(ctx: HostContext, path: string = '/'): string {
  const { protocol, hostWithoutPort, port } = parseHost(ctx)

  let mainDomain: string

  if (hostWithoutPort.endsWith('.localhost') || hostWithoutPort === 'localhost') {
    mainDomain = 'localhost'
  } else if (hostWithoutPort.endsWith('.nip.io')) {
    // Keep last 6 parts: 127.0.0.1.nip.io
    mainDomain = hostWithoutPort.split('.').slice(-6).join('.')
  } else {
    // Keep last 2 parts: example.com
    mainDomain = hostWithoutPort.split('.').slice(-2).join('.')
  }

  return `${protocol}://${mainDomain}${port}${path}`
}

/**
 * Build URL for a specific organization subdomain from request context
 */
export function getSubdomainUrl(ctx: HostContext, orgSlug: string, path: string = '/'): string {
  const { protocol, hostWithoutPort, port } = parseHost(ctx)

  let baseDomain: string

  if (hostWithoutPort.endsWith('.localhost') || hostWithoutPort === 'localhost') {
    baseDomain = 'localhost'
  } else if (hostWithoutPort.endsWith('.nip.io')) {
    baseDomain = hostWithoutPort.split('.').slice(-6).join('.')
  } else {
    baseDomain = hostWithoutPort.split('.').slice(-2).join('.')
  }

  return `${protocol}://${orgSlug}.${baseDomain}${port}${path}`
}

// =============================================================================
// URL Building (Client/Server compatible - uses env vars)
// =============================================================================

/**
 * Build a URL for a specific organization subdomain
 * Works in both client and server components using NEXT_PUBLIC_APP_URL
 */
export function buildOrgUrl(orgSlug: string, path: string = '/'): string {
  const appUrl = getAppUrl()
  const url = new URL(appUrl)

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = `${orgSlug}.localhost`
  } else {
    url.hostname = `${orgSlug}.${url.hostname}`
  }

  url.pathname = path
  return url.toString()
}

/**
 * Get the main domain URL using NEXT_PUBLIC_APP_URL
 * Works in both client and server components
 */
export function buildMainDomainUrl(path: string = '/'): string {
  const appUrl = getAppUrl()
  return `${appUrl}${path}`
}
