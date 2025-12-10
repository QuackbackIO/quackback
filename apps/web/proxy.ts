import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { auth } from '@/lib/auth/index'

/**
 * Multi-Tenant Routing Proxy (Next.js 16)
 *
 * Domain routing with path-based rewrites (Vercel Platforms pattern):
 * - Main domain (APP_DOMAIN): Landing page, workspace creation
 * - Tenant domains: Looked up in workspace_domain table, then REWRITTEN to /s/[orgSlug]/...
 *
 * The rewrite approach provides:
 * - Single tenant resolution (proxy only, not duplicated in pages)
 * - Tenant available via params.orgSlug in server components
 * - Better ISR/caching compatibility
 * - External URLs unchanged (still subdomain-based)
 *
 * Note: Per Next.js 16 best practices, the proxy should only do optimistic checks.
 * Full session validation should happen in Server Components/Route Handlers.
 * We use Better Auth's API to validate sessions here since it's fast (no extra DB query
 * when cookie cache is disabled - it just verifies the cookie signature).
 */

const APP_DOMAIN = process.env.APP_DOMAIN

/**
 * Public routes on main domain (no auth required)
 */
const mainDomainPublicRoutes = [
  '/', // Landing page
  '/create-workspace', // Tenant provisioning flow
  '/accept-invitation', // Invitation acceptance
  '/api/auth', // Auth API routes
  '/api/workspace', // Workspace creation API
]

/**
 * Auth routes on tenant domains (no auth required to access)
 */
const tenantAuthRoutes = ['/login', '/signup', '/sso', '/admin/login', '/admin/signup']

/**
 * Public routes on tenant domains (no auth required)
 */
const tenantPublicRoutes = ['/', '/roadmap', '/accept-invitation']

/**
 * Check if pathname matches public post detail route pattern: /b/:boardSlug/posts/:postId
 */
function isPublicPostRoute(pathname: string): boolean {
  return /^\/b\/[^/]+\/posts\/[^/]+$/.test(pathname)
}

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

/**
 * Validate session using Better Auth's API
 * Returns true if the session is valid, false otherwise
 */
async function isSessionValid(request: NextRequest): Promise<boolean> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    })
    return !!session?.user
  } catch {
    // Session validation failed - treat as invalid
    return false
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')
  if (!host) {
    return new NextResponse('Bad Request: Missing Host header', { status: 400 })
  }
  const protocol = getProtocol(request)
  // Check for both session cookies (session_data is the JWT cache, session_token is the DB fallback)
  const sessionTokenCookie = request.cookies.get('better-auth.session_token')
  const sessionDataCookie = request.cookies.get('better-auth.session_data')
  const hasSessionCookie = !!sessionTokenCookie || !!sessionDataCookie

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
  // Validate workspace exists and get organization slug for rewriting
  const domainRecord = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.domain, host),
    with: { organization: true },
  })

  if (!domainRecord?.organization) {
    // Workspace not found - rewrite to workspace-not-found page
    // This preserves the URL while showing the 404 content
    const url = request.nextUrl.clone()
    url.pathname = '/workspace-not-found'
    return NextResponse.rewrite(url)
  }

  const orgSlug = domainRecord.organization.slug

  // Helper to create rewrite response to /s/[orgSlug]/...
  const rewriteToSlug = (path: string = pathname) => {
    const url = request.nextUrl.clone()
    url.pathname = `/s/${orgSlug}${path}`
    return NextResponse.rewrite(url)
  }

  // Auth routes (login, signup, sso) - special session handling before rewrite
  if (tenantAuthRoutes.some((route) => pathname.startsWith(route))) {
    const hasError = request.nextUrl.searchParams.has('error')
    const hasInvitation = request.nextUrl.searchParams.has('invitation')

    // If user has an invitation, always allow access to signup page
    // (they may need to create a new account for this org even if logged in elsewhere)
    if (hasInvitation) {
      return rewriteToSlug()
    }

    // If cookie exists and no error, validate session before redirecting
    if (hasSessionCookie && !hasError) {
      const isValid = await isSessionValid(request)

      if (isValid) {
        // Valid session - redirect away from login
        return NextResponse.redirect(new URL(`${protocol}://${host}/`))
      } else {
        // Stale cookie - clear both cookies and rewrite to login page
        const response = rewriteToSlug()
        response.cookies.delete('better-auth.session_token')
        response.cookies.delete('better-auth.session_data')
        return response
      }
    }
    return rewriteToSlug()
  }

  // Public routes (/, /roadmap, /:boardSlug/posts/:postId) - no auth, just rewrite
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

  // Validate the session is actually valid
  const isValid = await isSessionValid(request)

  if (!isValid) {
    // Stale cookie - clear both cookies and redirect to login
    const loginUrl = new URL(`${protocol}://${host}/login`)
    loginUrl.searchParams.set(
      'callbackUrl',
      `${protocol}://${host}${pathname}${request.nextUrl.search}`
    )
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete('better-auth.session_token')
    response.cookies.delete('better-auth.session_data')
    return response
  }

  // Authenticated with valid session - rewrite to slug-based route
  return rewriteToSlug()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.webp$|api).*)',
  ],
}
