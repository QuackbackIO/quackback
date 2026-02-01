import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { isMultiTenant } from '@/lib/shared/features'
import { resolveTenantFromDomain, type TenantContext, tenantStorage } from '@/lib/server/tenant'
import { db } from '@/lib/db'

let requestId = 0

function ms(start: number): string {
  return `${(Date.now() - start).toString().padStart(4)}ms`
}

declare module '@tanstack/react-start' {
  interface Register {
    server: { requestContext: { tenant: TenantContext | null } }
  }
}

const STATIC_PATTERN =
  /^\/(_build|_static|static|\.vite)|^\/(health|favicon\.ico)$|\.(js|css|map|woff2?|png|jpg|svg|ico)$/

function shouldSkipTenantResolution(url: string): boolean {
  return STATIC_PATTERN.test(new URL(url).pathname)
}

function isAppDomain(request: Request): boolean {
  const appDomain = process.env.CLOUD_APP_DOMAIN
  if (!appDomain) return false
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()
  return host === appDomain.toLowerCase()
}

function createContext(
  type: TenantContext['contextType'],
  overrides: Partial<TenantContext> = {}
): TenantContext {
  return { contextType: type, slug: '', db: null, settings: null, cache: new Map(), ...overrides }
}

function shouldCacheResponse(request: Request, url: URL, status: number): boolean {
  const hasSession = request.headers.get('cookie')?.includes('better-auth.session_token')
  const isPortalRoute =
    url.pathname === '/' || url.pathname.startsWith('/post/') || url.pathname.startsWith('/roadmap')
  return !hasSession && isPortalRoute && request.method === 'GET' && status === 200
}

function withCacheHeaders(response: Response): Response {
  const cached = new Response(response.body, response)
  cached.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  cached.headers.set('Vary', 'Cookie')
  return cached
}

export default createServerEntry({
  async fetch(request) {
    const t0 = Date.now()
    const rid = ++requestId
    const url = new URL(request.url)
    const tag = `[${rid}]`

    console.log(`${tag} --> ${request.method} ${url.pathname}`)

    if (shouldSkipTenantResolution(request.url)) {
      const response = await handler.fetch(request, { context: { tenant: null } })
      console.log(`${tag} <-- ${ms(t0)} (static)`)
      return response
    }

    if (isAppDomain(request)) {
      const context = createContext('app-domain')
      return tenantStorage.run(context, async () => {
        const t1 = Date.now()
        const response = await handler.fetch(request, { context: { tenant: null } })
        console.log(`${tag} <-- ${ms(t0)} total | handler ${ms(t1)} (app-domain)`)
        return response
      })
    }

    if (!isMultiTenant()) {
      const t1 = Date.now()
      const settings = await db.query.settings.findFirst()
      const settingsTime = ms(t1)
      const context = createContext('self-hosted', {
        slug: settings?.slug ?? '',
        settings: settings ?? null,
      })

      return tenantStorage.run(context, async () => {
        const t2 = Date.now()
        const response = await handler.fetch(request, { context: { tenant: null } })
        console.log(
          `${tag} <-- ${ms(t0)} total | settings ${settingsTime} | handler ${ms(t2)} (self-hosted)`
        )
        return response
      })
    }

    const t1 = Date.now()
    const tenant = await resolveTenantFromDomain(request)
    const resolveTime = ms(t1)

    if (!tenant) {
      const context = createContext('unknown')
      return tenantStorage.run(context, async () => {
        const t2 = Date.now()
        const response = await handler.fetch(request, { context: { tenant: null } })
        console.log(
          `${tag} <-- ${ms(t0)} total | resolve ${resolveTime} | handler ${ms(t2)} (no-tenant: ${url.hostname})`
        )
        return response
      })
    }

    const context = createContext('tenant', {
      workspaceId: tenant.workspaceId,
      slug: tenant.slug,
      db: tenant.db,
      settings: tenant.settings,
      subscription: tenant.subscription,
    })

    return tenantStorage.run(context, async () => {
      const t2 = Date.now()
      const response = await handler.fetch(request, { context: { tenant: context } })
      console.log(
        `${tag} <-- ${ms(t0)} total | resolve ${resolveTime} | handler ${ms(t2)} (tenant: ${tenant.slug})`
      )

      return shouldCacheResponse(request, url, response.status)
        ? withCacheHeaders(response)
        : response
    })
  },
})
