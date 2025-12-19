import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Unified Middleware for Quackback
 *
 * Routes requests to the appropriate workspace based on domain.
 * Both local dev and cloud deployments use the internal API to look up
 * the workspace from the workspace_domain table.
 *
 * Main domain (APP_DOMAIN): Shows landing page or redirects to workspace
 * Workspace domains: Rewrites to /s/[workspaceSlug]/path
 */

const APP_DOMAIN = process.env.APP_DOMAIN

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

/** Public routes on main domain */
const mainDomainPublicRoutes = ['/', '/create-workspace', '/accept-invitation', '/api/']

/** Auth routes on workspace domains */
const workspaceAuthRoutes = ['/login', '/signup', '/sso', '/admin/login', '/admin/signup']

/** Public routes on workspace domains */
const workspacePublicRoutes = ['/', '/roadmap', '/accept-invitation']

/** Routes that should NOT be rewritten to /s/[workspaceSlug]/ (global pages) */
const globalRoutes = ['/workspace-not-found', '/create-workspace']

function isPublicPostRoute(pathname: string): boolean {
  return /^\/b\/[^/]+\/posts\/[^/]+$/.test(pathname)
}

function getProtocol(request: NextRequest): string {
  return request.headers.get('x-forwarded-proto') || 'https'
}

// Store the last error for debugging
let lastDomainLookupError: string | null = null

// In-memory cache for domain → slug mappings in middleware
// This avoids HTTP calls for repeated requests to the same domain
const middlewareCache = new Map<string, { slug: string | null; expiresAt: number }>()
const MIDDLEWARE_CACHE_TTL_MS = 30_000 // 30 seconds

/**
 * Look up workspace slug from domain via internal API.
 * - Cloudflare Workers: Uses WORKER_SELF_REFERENCE service binding
 * - Local dev: Uses direct fetch to the internal API endpoint
 * Results are cached in middleware memory for 30 seconds.
 */
async function getWorkspaceSlugFromDomain(
  host: string,
  request: NextRequest
): Promise<string | null> {
  lastDomainLookupError = null

  // Check middleware cache first
  const cached = middlewareCache.get(host)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.slug
  }

  try {
    let response: Response

    if (isCloudflareWorker()) {
      // Cloudflare Workers: Use service binding for internal call
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const ctx = getCloudflareContext()

      if (!ctx?.env?.WORKER_SELF_REFERENCE) {
        lastDomainLookupError = 'No WORKER_SELF_REFERENCE binding found'
        return null
      }

      response = await ctx.env.WORKER_SELF_REFERENCE.fetch(
        `https://internal/api/internal/resolve-domain?domain=${encodeURIComponent(host)}`,
        { method: 'GET' }
      )
    } else {
      // Local dev: Use direct fetch to internal API
      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      const internalUrl = `${protocol}://${APP_DOMAIN}/api/internal/resolve-domain?domain=${encodeURIComponent(host)}`
      response = await fetch(internalUrl, { method: 'GET' })
    }

    if (response.ok) {
      const data = (await response.json()) as { slug?: string | null; error?: string }
      const slug = data.slug ?? null

      // Cache the result
      middlewareCache.set(host, { slug, expiresAt: Date.now() + MIDDLEWARE_CACHE_TTL_MS })

      if (slug) {
        return slug
      }
      if (data.error) {
        lastDomainLookupError = data.error
        return null
      }
    } else {
      lastDomainLookupError = `API returned ${response.status}`
    }

    lastDomainLookupError = lastDomainLookupError || `No domain found for: ${host}`
    return null
  } catch (error) {
    lastDomainLookupError = `Error: ${error instanceof Error ? error.message : String(error)}`
    console.error('Error looking up domain:', host, error)
    return null
  }
}

// ============================================================================
// LOCAL ROUTING (Node.js / OSS Edition)
// ============================================================================

async function handleLocalRouting(request: NextRequest, pathname: string): Promise<NextResponse> {
  const host = request.headers.get('host')

  // .well-known routes - serve from root
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }

  // Global routes that shouldn't be rewritten (error pages, create-workspace, etc.)
  if (globalRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Look up workspace slug from domain (same as cloud mode)
  // In OSS mode, there's typically one workspace with domain matching APP_DOMAIN
  if (host) {
    const workspaceSlug = await getWorkspaceSlugFromDomain(host, request)

    if (workspaceSlug) {
      const url = request.nextUrl.clone()
      url.pathname = `/s/${workspaceSlug}${pathname}`
      return NextResponse.rewrite(url)
    }
  }

  // Fallback: No workspace found - redirect to create workspace
  // This handles the case where no workspace has been created yet
  if (pathname !== '/create-workspace') {
    return NextResponse.redirect(new URL('/create-workspace', request.url))
  }

  return NextResponse.next()
}

// ============================================================================
// CLOUD ROUTING (Cloudflare Workers)
// ============================================================================

async function handleCloudRouting(request: NextRequest, pathname: string): Promise<NextResponse> {
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

  // === WORKSPACE DOMAIN ===

  // Global routes that shouldn't be rewritten (error pages, etc.)
  if (globalRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.next()
  }

  // Look up workspace slug from workspace_domain table
  const workspaceSlug = await getWorkspaceSlugFromDomain(host, request)

  if (!workspaceSlug) {
    const url = request.nextUrl.clone()
    url.pathname = '/workspace-not-found'
    return NextResponse.rewrite(url)
  }

  const rewriteToSlug = (path: string = pathname) => {
    const url = request.nextUrl.clone()
    url.pathname = `/s/${workspaceSlug}${path}`
    return NextResponse.rewrite(url)
  }

  // Auth routes - rewrite without session check
  if (workspaceAuthRoutes.some((route) => pathname.startsWith(route))) {
    return rewriteToSlug()
  }

  // .well-known routes - serve from root
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }

  // Public routes - no auth, just rewrite
  if (
    workspacePublicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`)) ||
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
    const workspaceSlug = host ? await getWorkspaceSlugFromDomain(host, request) : null
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      runtime: isCloudflareWorker() ? 'cloudflare-workers' : 'node',
      host,
      pathname,
      appDomain: APP_DOMAIN,
      isMainDomain: host === APP_DOMAIN,
      workspaceSlug,
      domainLookupError: lastDomainLookupError,
    })
  }

  // Route based on runtime environment
  if (isCloudflareWorker()) {
    return await handleCloudRouting(request, pathname)
  }

  return await handleLocalRouting(request, pathname)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.webp$|api).*)',
  ],
}
