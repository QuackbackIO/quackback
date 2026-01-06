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
    if (!isMultiTenant()) {
      console.log('[server] Self-hosted mode - no tenant resolution needed')
      return handler.fetch(request, { context: { tenant: null } })
    }

    // Cloud: resolve tenant from domain via website API
    console.log(`[server] Multi-tenant mode - resolving tenant for domain: ${url.hostname}`)
    const tenant = await resolveTenantFromDomain(request)

    if (!tenant) {
      // Unknown or invalid domain - pass through without tenant context
      // The app can handle this case (e.g., show a "workspace not found" page)
      console.log(`[server] No tenant found for domain: ${url.hostname}`)
      return handler.fetch(request, { context: { tenant: null } })
    }

    console.log(`[server] Tenant resolved: ${tenant.workspaceId} for domain: ${url.hostname}`)

    // Run entire request within AsyncLocalStorage context
    // This allows db.ts and other services to access tenant db via tenantStorage.getStore()
    return tenantStorage.run(tenant, () => {
      console.log(`[server] Running request in tenant context: ${tenant.workspaceId}`)
      return handler.fetch(request, { context: { tenant } })
    })
  },
})
