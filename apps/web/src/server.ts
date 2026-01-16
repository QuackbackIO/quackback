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

export default createServerEntry({
  async fetch(request) {
    const url = new URL(request.url)
    console.log(`[server] Incoming request: ${request.method} ${url.pathname}`)

    // Skip tenant resolution for static assets
    if (shouldSkipTenantResolution(request.url)) {
      console.log(`[server] Skipping tenant resolution for static asset: ${url.pathname}`)
      return handler.fetch(request, { context: { tenant: null } })
    }

    // Self-hosted: no tenant resolution needed, uses DATABASE_URL singleton
    // Still wrap in tenantStorage for request-scoped caching and settings
    if (!isMultiTenant()) {
      console.log('[server] Self-hosted mode - querying settings')
      // Query settings once at request start (uses DATABASE_URL singleton)
      const settings = await db.query.settings.findFirst()
      const selfHostedContext: TenantContext = {
        workspaceId: 'self-hosted',
        slug: settings?.slug ?? '',
        db: null, // Self-hosted uses DATABASE_URL singleton via db.ts
        settings: settings ?? null,
        cache: new Map(),
      }
      return tenantStorage.run(selfHostedContext, () => {
        return handler.fetch(request, { context: { tenant: null } })
      })
    }

    // Cloud: resolve tenant from domain
    console.log(`[server] Multi-tenant mode - resolving tenant for domain: ${url.hostname}`)
    const tenant = await resolveTenantFromDomain(request)

    if (!tenant) {
      // Unknown or invalid domain - pass through with minimal context
      console.log(`[server] No tenant found for domain: ${url.hostname}`)
      const noTenantContext: TenantContext = {
        workspaceId: 'unknown',
        slug: '',
        db: null,
        settings: null,
        cache: new Map(),
      }
      return tenantStorage.run(noTenantContext, () => {
        return handler.fetch(request, { context: { tenant: null } })
      })
    }

    console.log(`[server] Tenant resolved: ${tenant.workspaceId} for domain: ${url.hostname}`)

    // Query settings once using tenant's db directly (before setting up full context)
    const settings = await tenant.db.query.settings.findFirst()

    // Build full tenant context with settings and cache
    const tenantContext: TenantContext = {
      workspaceId: tenant.workspaceId,
      slug: tenant.slug,
      db: tenant.db,
      settings: settings ?? null,
      cache: new Map(),
    }

    // Run entire request within AsyncLocalStorage context
    // This allows db.ts and other services to access tenant db via tenantStorage.getStore()
    return tenantStorage.run(tenantContext, () => {
      console.log(`[server] Running request in tenant context: ${tenant.workspaceId}`)
      return handler.fetch(request, { context: { tenant: tenantContext } })
    })
  },
})
