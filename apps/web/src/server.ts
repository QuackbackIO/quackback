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

    // Cloud: resolve tenant from domain
    console.log(`[server] Multi-tenant mode - resolving tenant for domain: ${url.hostname}`)
    const tenant = await resolveTenantFromDomain(request)

    if (!tenant) {
      // Unknown or invalid domain - render workspace not found page directly
      console.log(`[server] No tenant found for domain: ${url.hostname}`)
      return new Response(workspaceNotFoundHtml(), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
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

/**
 * Static HTML for workspace not found page.
 * Rendered directly when tenant resolution fails in cloud mode.
 */
function workspaceNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workspace Not Found · Quackback</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      background: #fafafa;
      color: #18181b;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 400px;
      text-align: center;
    }

    .icon {
      width: 72px;
      height: 72px;
      margin: 0 auto 32px;
      background: #f4f4f5;
      border-radius: 16px;
      display: grid;
      place-items: center;
      border: 1px solid #e4e4e7;
    }

    .icon svg {
      width: 32px;
      height: 32px;
      color: #71717a;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.025em;
      margin-bottom: 12px;
    }

    .description {
      color: #71717a;
      line-height: 1.6;
      font-size: 15px;
    }

    .actions {
      margin-top: 32px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    @media (min-width: 480px) {
      .actions {
        flex-direction: row;
        justify-content: center;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 40px;
      padding: 0 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s ease;
    }

    .btn-primary {
      background: #18181b;
      color: #fff;
    }

    .btn-primary:hover {
      background: #27272a;
    }

    .btn-secondary {
      background: #fff;
      color: #18181b;
      border: 1px solid #e4e4e7;
    }

    .btn-secondary:hover {
      background: #fafafa;
      border-color: #d4d4d8;
    }

    .help {
      margin-top: 32px;
      font-size: 13px;
      color: #a1a1aa;
    }

    .help a {
      color: #52525b;
      text-decoration: none;
    }

    .help a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
    </div>
    <h1>Workspace not found</h1>
    <p class="description">We couldn't find a workspace at this address. It may have been moved, deleted, or the URL might be incorrect.</p>
    <div class="actions">
      <a href="https://quackback.io" class="btn btn-primary">Go to Quackback</a>
      <a href="https://quackback.io/signup" class="btn btn-secondary">Create a workspace</a>
    </div>
    <p class="help">Need help? Contact <a href="mailto:support@quackback.io">support@quackback.io</a></p>
  </main>
</body>
</html>`
}
