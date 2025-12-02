import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { parseSubdomain, getMainDomainUrl } from './lib/routing'

/**
 * Routes that don't require authentication (on main domain)
 */
const publicRoutes = ['/login', '/signup', '/forgot-password', '/accept-invitation']

/**
 * Routes that are only accessible on the main domain (no subdomain)
 */
const mainDomainOnlyRoutes = [
  '/login',
  '/signup',
  '/forgot-password',
  '/accept-invitation',
  '/select-org',
  '/create-org',
]

/**
 * Get host context from request for URL building
 */
function getHostContext(request: NextRequest) {
  return {
    host: request.headers.get('host') || 'localhost:3000',
    protocol: request.headers.get('x-forwarded-proto') || 'http',
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const ctx = getHostContext(request)
  const subdomain = parseSubdomain(ctx.host)
  const sessionCookie = request.cookies.get('better-auth.session_token')

  // Pass subdomain to downstream server components via header
  const requestHeaders = new Headers(request.headers)
  if (subdomain) {
    requestHeaders.set('x-org-slug', subdomain)
  }

  // === MAIN DOMAIN (no subdomain) ===
  if (!subdomain) {
    // Public routes - allow access
    if (publicRoutes.some((route) => pathname.startsWith(route))) {
      // If logged in on auth routes, redirect to org selection
      if (sessionCookie && ['/login', '/signup'].some((r) => pathname.startsWith(r))) {
        return NextResponse.redirect(new URL('/select-org', request.url))
      }
      return NextResponse.next()
    }

    // Org management routes - require auth
    if (pathname.startsWith('/select-org') || pathname.startsWith('/create-org')) {
      if (!sessionCookie) {
        return NextResponse.redirect(new URL('/login', request.url))
      }
      return NextResponse.next()
    }

    // Homepage - redirect based on auth
    if (pathname === '/') {
      return NextResponse.redirect(new URL(sessionCookie ? '/select-org' : '/login', request.url))
    }

    // Other routes on main domain - require auth
    if (!sessionCookie) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Logged in but no subdomain - go to org selection
    return NextResponse.redirect(new URL('/select-org', request.url))
  }

  // === SUBDOMAIN (tenant context) ===

  // Redirect auth routes to main domain
  if (mainDomainOnlyRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL(getMainDomainUrl(ctx, pathname)))
  }

  // Require authentication
  if (!sessionCookie) {
    const loginUrl = new URL(getMainDomainUrl(ctx, '/login'))
    const callbackUrl = `${ctx.protocol}://${ctx.host}${pathname}${request.nextUrl.search}`
    loginUrl.searchParams.set('callbackUrl', callbackUrl)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated on subdomain - allow access
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public).*)'],
}
