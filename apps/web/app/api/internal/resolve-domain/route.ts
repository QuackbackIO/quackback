import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { eq, workspaceDomain, workspace } from '@quackback/db'

// In-memory cache for domain → slug mappings
// Cache entries expire after 60 seconds
const domainCache = new Map<string, { slug: string | null; expiresAt: number }>()
const CACHE_TTL_MS = 60_000 // 60 seconds

/**
 * Internal API endpoint for resolving custom domains to workspace slugs.
 * Used by middleware which can't make direct database queries (Edge Runtime limitation).
 *
 * Results are cached in memory for 60 seconds to reduce database load.
 *
 * This endpoint is NOT rate-limited and should only be called internally
 * via Cloudflare service binding (WORKER_SELF_REFERENCE) or local fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const domain = url.searchParams.get('domain')

  if (!domain) {
    return NextResponse.json({ error: 'Missing domain parameter' }, { status: 400 })
  }

  // Check cache first
  const cached = domainCache.get(domain)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ slug: cached.slug })
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

    // Cache the result
    domainCache.set(domain, { slug, expiresAt: Date.now() + CACHE_TTL_MS })

    return NextResponse.json({ slug })
  } catch (error) {
    console.error('Error resolving domain:', domain, error)
    return NextResponse.json({ error: 'Failed to resolve domain' }, { status: 500 })
  }
}
