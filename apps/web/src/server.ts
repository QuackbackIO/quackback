/**
 * TanStack Start Server Entry
 *
 * Custom server entry point for multi-tenant request handling.
 * For cloud deployments, resolves domain to tenant and injects database context.
 * For self-hosted deployments, passes through to default handler.
 *
 * TanStack Start auto-discovers this file at src/server.ts.
 */
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { isMultiTenant } from '@/lib/features'
import { resolveTenantFromDomain, type TenantContext, tenantStorage } from '@/lib/tenant'
import { db } from '@/lib/db'

// Type-safe request context (TanStack Start module augmentation)
declare module '@tanstack/react-start' {
  interface Register {
    server: {
      requestContext: { tenant: TenantContext | null }
    }
  }
}

/**
 * Paths that should skip tenant resolution.
 * Static assets, health checks, and framework internals.
 * NOTE: /_serverFn/ paths MUST NOT be skipped - they need tenant context!
 */
function shouldSkipTenantResolution(url: string): boolean {
  const { pathname } = new URL(url)
  // Skip Vite internals, static assets, and health checks
  // But NOT /_serverFn/ which needs tenant context for database access
  return /^\/(_build|_static|static|\.vite)|^\/(health|favicon\.ico)$|\.(js|css|map|woff2?|png|jpg|svg|ico)$/.test(
    pathname
  )
}

/**
 * Check if request is on the app domain (CLOUD_APP_DOMAIN).
 * App domain hosts routes like /get-started that don't need tenant context.
 */
function checkIsAppDomain(request: Request): boolean {
  const appDomain = process.env.CLOUD_APP_DOMAIN
  if (!appDomain) return false

  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()
  return host === appDomain.toLowerCase()
}

export default createServerEntry({
  async fetch(request) {
    const url = new URL(request.url)
    console.log(`[server] Incoming request: ${request.method} ${url.pathname}`)

    // Skip tenant resolution for static assets
    if (shouldSkipTenantResolution(request.url)) {
      console.log(`[server] Skipping tenant resolution for static asset: ${url.pathname}`)
      return handler.fetch(request, { context: { tenant: null } })
    }

    // App domain (e.g., app.quackback.io): skip tenant resolution
    // These routes (like /get-started) don't need a tenant database
    if (checkIsAppDomain(request)) {
      console.log(`[server] App domain request - skipping tenant resolution`)
      const context: TenantContext = {
        contextType: 'app-domain',
        slug: '',
        db: null,
        settings: null,
        cache: new Map(),
      }
      return tenantStorage.run(context, () => {
        return handler.fetch(request, { context: { tenant: null } })
      })
    }

    // Self-hosted: no tenant resolution needed, uses DATABASE_URL singleton
    // Still wrap in tenantStorage for request-scoped caching and settings
    if (!isMultiTenant()) {
      console.log('[server] Self-hosted mode - querying settings')
      const settings = await db.query.settings.findFirst()
      const context: TenantContext = {
        contextType: 'self-hosted',
        slug: settings?.slug ?? '',
        db: null,
        settings: settings ?? null,
        cache: new Map(),
      }
      return tenantStorage.run(context, () => {
        return handler.fetch(request, { context: { tenant: null } })
      })
    }

    // Cloud: resolve tenant from domain
    console.log(`[server] Multi-tenant mode - resolving tenant for domain: ${url.hostname}`)
    const tenant = await resolveTenantFromDomain(request)

    if (!tenant) {
      console.log(`[server] No tenant found for domain: ${url.hostname}`)
      const context: TenantContext = {
        contextType: 'unknown',
        slug: '',
        db: null,
        settings: null,
        cache: new Map(),
      }
      return tenantStorage.run(context, () => {
        return handler.fetch(request, { context: { tenant: null } })
      })
    }

    console.log(`[server] Tenant resolved: ${tenant.workspaceId} for domain: ${url.hostname}`)

    // Query settings once using tenant's db directly
    const settings = await tenant.db.query.settings.findFirst()

    const context: TenantContext = {
      contextType: 'tenant',
      workspaceId: tenant.workspaceId,
      slug: tenant.slug,
      db: tenant.db,
      settings: settings ?? null,
      cache: new Map(),
    }

    return tenantStorage.run(context, () => {
      console.log(`[server] Running request in tenant context: ${tenant.workspaceId}`)
      return handler.fetch(request, { context: { tenant: context } })
    })
  },
})
