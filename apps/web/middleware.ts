import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Unified Middleware for Quackback
 *
 * Routing mode is auto-detected based on runtime environment:
 * - Cloudflare Workers: Multi-tenant routing with subdomain + custom domain support
 * - Node.js / Local dev: Single-tenant routing, rewrites all to /s/[DEFAULT_ORG_SLUG]/
 */

const APP_DOMAIN = process.env.APP_DOMAIN
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'default'

/** Auto-detect Cloudflare Workers runtime */
function isCloudflareWorker(): boolean {
  try {
    return (
      typeof globalThis !== 'undefined' &&
      'caches' in globalThis &&
      typeof (globalThis as unknown as { caches: { default?: unknown } }).caches?.default !==
        'undefined'
    )
  } catch {
    return false
  }
}

// Cloud-only: Augment the CloudflareEnv interface with our custom bindings
declare global {
  interface CloudflareEnv {
    HYPERDRIVE: Hyperdrive
    WORKER_SELF_REFERENCE: Fetcher
  }
}

/** Public routes on main domain (cloud only) */
const mainDomainPublicRoutes = ['/', '/create-workspace', '/accept-invitation', '/api/']

/** Auth routes on tenant domains */
const tenantAuthRoutes = ['/login', '/signup', '/sso', '/admin/login', '/admin/signup']

/** Public routes on tenant domains */
const tenantPublicRoutes = ['/', '/roadmap', '/accept-invitation']

/** Routes that should NOT be rewritten to /s/[orgSlug]/ (global pages) */
const globalRoutes = ['/workspace-not-found']

function isPublicPostRoute(pathname: string): boolean {
  return /^\/b\/[^/]+\/posts\/[^/]+$/.test(pathname)
}

function getProtocol(request: NextRequest): string {
  return request.headers.get('x-forwarded-proto') || 'https'
}

/**
 * Extract org slug from subdomain.
 * For example: acme.quackback.io -> acme
 */
function getOrgSlugFromSubdomain(host: string): string | null {
  if (!APP_DOMAIN) return null

  const hostWithoutPort = host.split(':')[0]
  const appDomainWithoutPort = APP_DOMAIN.split(':')[0]

  if (hostWithoutPort.endsWith(`.${appDomainWithoutPort}`)) {
    const subdomain = hostWithoutPort.replace(`.${appDomainWithoutPort}`, '')
    if (subdomain && !subdomain.includes('.')) {
      return subdomain
    }
  }

  return null
}

// Store the last error for debugging (cloud only)
let lastDomainLookupError: string | null = null

/**
 * Look up org slug from custom domain via service binding (cloud only).
 * Uses WORKER_SELF_REFERENCE to call internal API route without external network hop.
 */
async function getOrgSlugFromCustomDomain(host: string): Promise<string | null> {
  lastDomainLookupError = null

  // Skip custom domain lookup during local dev (no Cloudflare context)
  if (!isCloudflareWorker()) {
    lastDomainLookupError = 'Custom domain lookup not available in local dev'
    return null
  }

  try {
    // Dynamic import to avoid loading @opennextjs/cloudflare in Node.js
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const ctx = getCloudflareContext()

    if (ctx?.env?.WORKER_SELF_REFERENCE) {
      const response = await ctx.env.WORKER_SELF_REFERENCE.fetch(
        `https://internal/api/internal/resolve-domain?domain=${encodeURIComponent(host)}`,
        { method: 'GET' }
      )

      if (response.ok) {
        const data = (await response.json()) as { slug?: string | null; error?: string }
        if (data.slug) {
          return data.slug
        }
        if (data.error) {
          lastDomainLookupError = data.error
          return null
        }
      } else {
        lastDomainLookupError = `Service binding returned ${response.status}`
      }
    } else {
      lastDomainLookupError = 'No WORKER_SELF_REFERENCE binding found'
    }

    lastDomainLookupError = lastDomainLookupError || `No domain found for: ${host}`
    return null
  } catch (error) {
    lastDomainLookupError = `Error: ${error instanceof Error ? error.message : String(error)}`
    console.error('Error looking up custom domain:', host, error)
    return null
  }
}

// ============================================================================
// SINGLE-TENANT ROUTING (OSS)
// ============================================================================

function handleSingleTenant(request: NextRequest, pathname: string): NextResponse {
  // .well-known routes - serve from root
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }

  // Global routes that shouldn't be rewritten
  if (globalRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Rewrite all routes to /s/[DEFAULT_ORG_SLUG]/
  const url = request.nextUrl.clone()
  url.pathname = `/s/${DEFAULT_ORG_SLUG}${pathname}`
  return NextResponse.rewrite(url)
}

// ============================================================================
// MULTI-TENANT ROUTING (CLOUD)
// ============================================================================

async function handleMultiTenant(request: NextRequest, pathname: string): Promise<NextResponse> {
  const host = request.headers.get('host')

  if (!host) {
    return new NextResponse('Bad Request: Missing Host header', { status: 400 })
  }

  const protocol = getProtocol(request)

  // Get session token from cookies
  const isSecure = !APP_DOMAIN?.includes('localhost')
  const cookiePrefix = isSecure ? '__Secure-' : ''
  const sessionTokenCookie = request.cookies.get(`${cookiePrefix}better-auth.session_token`)
  const hasSessionCookie = !!sessionTokenCookie

  // === MAIN DOMAIN ===
  if (host === APP_DOMAIN) {
    if (mainDomainPublicRoutes.some((route) => pathname.startsWith(route))) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  // === TENANT DOMAIN ===

  // Global routes that shouldn't be rewritten (error pages, etc.)
  if (globalRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Try subdomain first, then custom domain lookup
  let orgSlug = getOrgSlugFromSubdomain(host)

  if (!orgSlug) {
    orgSlug = await getOrgSlugFromCustomDomain(host)
  }

  if (!orgSlug) {
    const url = request.nextUrl.clone()
    url.pathname = '/workspace-not-found'
    return NextResponse.rewrite(url)
  }

  const rewriteToSlug = (path: string = pathname) => {
    const url = request.nextUrl.clone()
    url.pathname = `/s/${orgSlug}${path}`
    return NextResponse.rewrite(url)
  }

  // Auth routes - rewrite without session check
  if (tenantAuthRoutes.some((route) => pathname.startsWith(route))) {
    return rewriteToSlug()
  }

  // .well-known routes - serve from root
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }

  // Public routes - no auth, just rewrite
  if (
    tenantPublicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`)) ||
    isPublicPostRoute(pathname)
  ) {
    return rewriteToSlug()
  }

  // Protected routes require authentication
  if (!hasSessionCookie) {
    const loginUrl = new URL(`${protocol}://${host}/login`)
    loginUrl.searchParams.set(
      'callbackUrl',
      `${protocol}://${host}${pathname}${request.nextUrl.search}`
    )
    return NextResponse.redirect(loginUrl)
  }

  // Has session cookie - just rewrite (validation happens in page)
  return rewriteToSlug()
}

// ============================================================================
// MAIN MIDDLEWARE
// ============================================================================

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')

  // Debug endpoint
  if (pathname === '/__debug-middleware') {
    const isCloud = isCloudflareWorker()
    if (isCloud) {
      const subdomainSlug = host ? getOrgSlugFromSubdomain(host) : null
      const customDomainSlug =
        !subdomainSlug && host ? await getOrgSlugFromCustomDomain(host) : null
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        runtime: 'cloudflare-workers',
        mode: 'multi-tenant',
        host,
        pathname,
        appDomain: APP_DOMAIN,
        isMain: host === APP_DOMAIN,
        subdomainSlug,
        customDomainSlug,
        orgSlug: subdomainSlug || customDomainSlug,
        domainLookupError: lastDomainLookupError,
      })
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      runtime: 'node',
      mode: 'single-tenant',
      pathname,
      orgSlug: DEFAULT_ORG_SLUG,
    })
  }

  // Route based on runtime environment
  if (isCloudflareWorker()) {
    return handleMultiTenant(request, pathname)
  }

  return handleSingleTenant(request, pathname)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.webp$|api).*)',
  ],
}
