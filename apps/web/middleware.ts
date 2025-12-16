import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for Multi-Tenant Routing
 *
 * Simple domain routing with path-based rewrites:
 * - Main domain (APP_DOMAIN): Landing page, workspace creation
 * - Tenant domains: Extract org slug from subdomain, rewrite to /s/[orgSlug]/...
 */

const APP_DOMAIN = process.env.APP_DOMAIN

/** Public routes on main domain */
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

function isMainDomain(host: string): boolean {
  return host === APP_DOMAIN
}

function getProtocol(request: NextRequest): string {
  return request.headers.get('x-forwarded-proto') || 'https'
}

/**
 * Extract org slug from subdomain.
 * For example: acme.test.quackback.io -> acme
 */
function getOrgSlugFromHost(host: string): string | null {
  if (!APP_DOMAIN) return null

  // Remove port if present
  const hostWithoutPort = host.split(':')[0]
  const appDomainWithoutPort = APP_DOMAIN.split(':')[0]

  // Check if this is a subdomain of APP_DOMAIN
  if (hostWithoutPort.endsWith(`.${appDomainWithoutPort}`)) {
    const subdomain = hostWithoutPort.replace(`.${appDomainWithoutPort}`, '')
    // Only return if it's a simple subdomain (no dots)
    if (subdomain && !subdomain.includes('.')) {
      return subdomain
    }
  }

  return null
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')

  // Debug endpoint
  if (pathname === '/__debug-middleware') {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      host,
      pathname,
      appDomain: APP_DOMAIN,
      isMain: host ? isMainDomain(host) : null,
      orgSlug: host ? getOrgSlugFromHost(host) : null,
    })
  }

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
  if (isMainDomain(host)) {
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

  const orgSlug = getOrgSlugFromHost(host)

  if (!orgSlug) {
    // Not a recognized subdomain pattern, show workspace-not-found
    const url = request.nextUrl.clone()
    url.pathname = '/workspace-not-found'
    return NextResponse.rewrite(url)
  }

  const rewriteToSlug = (path: string = pathname) => {
    const url = request.nextUrl.clone()
    url.pathname = `/s/${orgSlug}${path}`
    return NextResponse.rewrite(url)
  }

  // Auth routes - rewrite without session check for simplicity
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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.webp$|api).*)',
  ],
}
