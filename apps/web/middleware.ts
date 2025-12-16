import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for Single-Tenant Routing (OSS)
 *
 * Rewrites all routes to /s/[orgSlug]/ structure for compatibility
 * with the route layout. The org slug is configured via environment
 * variable or defaults to 'default'.
 *
 * For multi-tenant subdomain routing, see quackback-cloud.
 */

const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'default'

/** Routes that should NOT be rewritten (global pages) */
const globalRoutes = ['/workspace-not-found']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Debug endpoint
  if (pathname === '/__debug-middleware') {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      pathname,
      orgSlug: DEFAULT_ORG_SLUG,
      mode: 'single-tenant',
    })
  }

  // .well-known routes - serve from root
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }

  // Global routes that shouldn't be rewritten
  if (globalRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Rewrite all routes to /s/[orgSlug]/
  const url = request.nextUrl.clone()
  url.pathname = `/s/${DEFAULT_ORG_SLUG}${pathname}`
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.webp$|api).*)',
  ],
}
