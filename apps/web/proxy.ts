import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Multi-Tenant Routing Proxy (Next.js 16)
 *
 * Simple domain routing:
 * - Main domain (APP_DOMAIN): Landing page, workspace creation
 * - Tenant domains (anything else): Looked up in workspace_domain table
 */

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Public routes on main domain (no auth required)
 */
const mainDomainPublicRoutes = [
  '/', // Landing page
  '/create-workspace', // Tenant provisioning flow
  '/forgot-password', // Password reset
  '/accept-invitation', // Invitation acceptance
  '/api/auth', // Auth API routes
  '/api/workspace', // Workspace creation API
]

/**
 * Auth routes on tenant domains (no auth required to access)
 */
const tenantAuthRoutes = ['/login', '/signup', '/sso']

/**
 * Public routes on tenant domains (no auth required)
 */
const tenantPublicRoutes = ['/', '/boards', '/roadmap']

/**
 * Check if this is the main application domain
 */
function isMainDomain(host: string): boolean {
  return host === APP_DOMAIN
}

/**
 * Get protocol from request headers
 */
function getProtocol(request: NextRequest): string {
  return request.headers.get('x-forwarded-proto') || 'http'
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')
  if (!host) {
    return new NextResponse('Bad Request: Missing Host header', { status: 400 })
  }
  const protocol = getProtocol(request)
  const sessionCookie = request.cookies.get('better-auth.session_token')

  // === MAIN DOMAIN ===
  if (isMainDomain(host)) {
    // Public routes - allow access
    if (mainDomainPublicRoutes.some((route) => pathname.startsWith(route))) {
      return NextResponse.next()
    }
    // Any other route on main domain - redirect to landing page
    return NextResponse.redirect(new URL('/', request.url))
  }

  // === TENANT DOMAIN ===
  // (Domain validated against workspace_domain table in tenant.ts)

  // Auth routes (login, signup, sso)
  if (tenantAuthRoutes.some((route) => pathname.startsWith(route))) {
    // If logged in and no error, redirect to admin
    const hasError = request.nextUrl.searchParams.has('error')
    if (sessionCookie && !hasError) {
      return NextResponse.redirect(new URL(`${protocol}://${host}/admin`))
    }
    return NextResponse.next()
  }

  // Public routes (/boards, /roadmap)
  if (tenantPublicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Protected routes require authentication
  if (!sessionCookie) {
    const loginUrl = new URL(`${protocol}://${host}/login`)
    loginUrl.searchParams.set(
      'callbackUrl',
      `${protocol}://${host}${pathname}${request.nextUrl.search}`
    )
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated - allow access
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public|api).*)'],
}
