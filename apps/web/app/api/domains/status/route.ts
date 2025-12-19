import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@/lib/db'
import { auth } from '@/lib/auth'
import { isValidTypeId, type DomainId } from '@quackback/ids'
import { isCloud } from '@quackback/domain/features'
import { isCloudflareConfigured, getCustomHostname } from '@quackback/ee/cloudflare'

/**
 * Domain Status API
 *
 * Polls Cloudflare for current SSL status and syncs to database.
 * Used by UI for real-time status updates on CF-managed domains.
 */

/**
 * GET /api/domains/status?domainId=xxx
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const domainIdParam = request.nextUrl.searchParams.get('domainId')
  if (!domainIdParam || !isValidTypeId(domainIdParam, 'domain')) {
    return NextResponse.json({ error: 'domainId is required' }, { status: 400 })
  }
  const domainId = domainIdParam as DomainId

  // Get domain with membership check
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      workspace: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
          },
        },
      },
    },
  })

  if (!domain) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  const member = domain.workspace.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // If no CF hostname ID, return current state (self-hosted mode)
  if (!domain.cloudflareHostnameId) {
    return NextResponse.json({
      sslStatus: null,
      ownershipStatus: null,
      verified: domain.verified,
      mode: 'self-hosted',
    })
  }

  // Cloud mode: fetch latest from Cloudflare
  if (!isCloud() || !isCloudflareConfigured()) {
    return NextResponse.json({
      sslStatus: domain.sslStatus,
      ownershipStatus: domain.ownershipStatus,
      verified: domain.verified,
      mode: 'cached',
    })
  }

  try {
    const cfHostname = await getCustomHostname(domain.cloudflareHostnameId)

    if (!cfHostname) {
      return NextResponse.json({
        sslStatus: 'deleted',
        ownershipStatus: 'deleted',
        verified: false,
        mode: 'cloudflare',
      })
    }

    // Sync status to database
    const verified = cfHostname.ssl.status === 'active'
    await db
      .update(workspaceDomain)
      .set({
        sslStatus: cfHostname.ssl.status,
        ownershipStatus: cfHostname.status,
        verified,
        verificationToken: verified ? null : undefined,
      })
      .where(eq(workspaceDomain.id, domainId))

    return NextResponse.json({
      sslStatus: cfHostname.ssl.status,
      ownershipStatus: cfHostname.status,
      verified,
      mode: 'cloudflare',
    })
  } catch (error) {
    console.error('[Domain Status] Failed to fetch CF status:', error)
    return NextResponse.json({
      sslStatus: domain.sslStatus,
      ownershipStatus: domain.ownershipStatus,
      verified: domain.verified,
      mode: 'cached',
      error: 'Failed to fetch live status',
    })
  }
}
