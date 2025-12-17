import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { eq, workspaceDomain, organization } from '@quackback/db'

/**
 * Internal API endpoint for resolving custom domains to org slugs.
 * Used by middleware which can't make direct database queries (Edge Runtime limitation).
 *
 * This endpoint is NOT rate-limited and should only be called internally
 * via Cloudflare service binding (WORKER_SELF_REFERENCE).
 *
 * Only used when running in Cloudflare Workers (multi-tenant mode).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const domain = url.searchParams.get('domain')

  if (!domain) {
    return NextResponse.json({ error: 'Missing domain parameter' }, { status: 400 })
  }

  try {
    const db = getDb()

    const result = await db
      .select({ slug: organization.slug })
      .from(workspaceDomain)
      .innerJoin(organization, eq(organization.id, workspaceDomain.organizationId))
      .where(eq(workspaceDomain.domain, domain))
      .limit(1)

    if (result.length > 0) {
      return NextResponse.json({ slug: result[0].slug })
    }

    return NextResponse.json({ slug: null })
  } catch (error) {
    console.error('Error resolving domain:', domain, error)
    return NextResponse.json({ error: 'Failed to resolve domain' }, { status: 500 })
  }
}
