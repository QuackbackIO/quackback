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

// Stub DO class for Cloudflare migration - remove after delete-class migration completes
export { IntegrationStateDO } from '@/lib/stubs/integration-state-do'

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
 */
function shouldSkipTenantResolution(url: string): boolean {
  const path = new URL(url).pathname
  return (
    path.startsWith('/_') ||
    path.startsWith('/static') ||
    path.startsWith('/.vite') ||
    path === '/health' ||
    path === '/favicon.ico' ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.map') ||
    path.endsWith('.woff') ||
    path.endsWith('.woff2') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.svg') ||
    path.endsWith('.ico')
  )
}

export default createServerEntry({
  async fetch(request) {
    // Skip tenant resolution for static assets
    if (shouldSkipTenantResolution(request.url)) {
      return handler.fetch(request, { context: { tenant: null } })
    }

    // Self-hosted: no tenant resolution needed, uses DATABASE_URL singleton
    if (!isMultiTenant()) {
      return handler.fetch(request, { context: { tenant: null } })
    }

    // Cloud: resolve tenant from domain via website API
    const tenant = await resolveTenantFromDomain(request)

    if (!tenant) {
      // Unknown or invalid domain - pass through without tenant context
      // The app can handle this case (e.g., show a "workspace not found" page)
      return handler.fetch(request, { context: { tenant: null } })
    }

    // Run entire request within AsyncLocalStorage context
    // This allows db.ts and other services to access tenant db via tenantStorage.getStore()
    return tenantStorage.run(tenant, () => {
      return handler.fetch(request, { context: { tenant } })
    })
  },
})
