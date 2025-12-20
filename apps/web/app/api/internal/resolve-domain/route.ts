import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { eq, workspaceDomain, workspace } from '@quackback/db'

const CACHE_TTL_SECONDS = 60

/** Check if running in Cloudflare Workers */
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

/**
 * Internal API endpoint for resolving custom domains to workspace slugs.
 * Used by middleware which can't make direct database queries (Edge Runtime limitation).
 *
 * In Cloudflare Workers, results are cached using the Cache API for 60 seconds.
 * This endpoint is NOT rate-limited and should only be called internally
 * via Cloudflare service binding (WORKER_SELF_REFERENCE) or local fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const domain = url.searchParams.get('domain')

  if (!domain) {
    return NextResponse.json({ error: 'Missing domain parameter' }, { status: 400 })
  }

  // In Cloudflare Workers, check the Cache API first
  const cacheKey = new Request(`https://cache.internal/resolve-domain/${domain}`)
  if (isCloudflareWorker()) {
    try {
      const cache = (caches as unknown as { default: Cache }).default
      const cachedResponse = await cache.match(cacheKey)
      if (cachedResponse) {
        return cachedResponse
      }
    } catch {
      // Cache miss or error, continue to DB lookup
    }
  }

  try {
    const db = getDb()

    const result = await db
      .select({ slug: workspace.slug })
      .from(workspaceDomain)
      .innerJoin(workspace, eq(workspace.id, workspaceDomain.workspaceId))
      .where(eq(workspaceDomain.domain, domain))
      .limit(1)

    const slug = result.length > 0 ? result[0].slug : null

    const response = NextResponse.json({ slug })

    // In Cloudflare Workers, cache the response
    if (isCloudflareWorker()) {
      try {
        const cache = (caches as unknown as { default: Cache }).default
        const cacheableResponse = new Response(JSON.stringify({ slug }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          },
        })
        // Don't await - fire and forget
        cache.put(cacheKey, cacheableResponse)
      } catch {
        // Ignore cache errors
      }
    }

    return response
  } catch (error) {
    console.error('Error resolving domain:', domain, error)
    return NextResponse.json({ error: 'Failed to resolve domain' }, { status: 500 })
  }
}
