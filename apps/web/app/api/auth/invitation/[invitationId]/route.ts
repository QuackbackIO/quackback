import { NextRequest, NextResponse } from 'next/server'
import { db, invitation, workspaceDomain, eq } from '@quackback/db'
import { checkRateLimit, rateLimits, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'
import { isValidTypeId, toUuid, fromUuid } from '@quackback/ids'

interface RouteParams {
  params: Promise<{ invitationId: string }>
}

/**
 * GET /api/auth/invitation/[invitationId]
 *
 * Public endpoint to get invitation details for the signup form.
 * Returns basic info about the invitation (email, org name, inviter name).
 * Does NOT require authentication - this is used before signup.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { invitationId: invitationIdParam } = await params

    // Parse TypeID to UUID for database query (invitation table uses raw UUIDs)
    if (!isValidTypeId(invitationIdParam, 'invite')) {
      return NextResponse.json({ error: 'Invalid invitation ID format' }, { status: 400 })
    }
    const invitationId = toUuid(invitationIdParam)

    // Rate limit by IP to prevent invitation enumeration
    const clientIp = getClientIp(request.headers)
    const rateLimitResult = checkRateLimit(`invitation:${clientIp}`, rateLimits.apiGeneral)

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult),
        }
      )
    }

    // Get organization from host header
    const host = request.headers.get('host')
    if (!host) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Look up organization from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, host),
      with: { organization: true },
    })

    const org = domainRecord?.organization
    if (!org) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Find the invitation
    const inv = await db.query.invitation.findFirst({
      where: eq(invitation.id, invitationId),
      with: {
        organization: true,
        inviter: true,
      },
    })

    if (!inv) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Verify invitation belongs to this organization
    if (inv.organizationId !== org.id) {
      return NextResponse.json(
        { error: 'This invitation is for a different organization' },
        { status: 400 }
      )
    }

    // Check invitation status
    if (inv.status !== 'pending') {
      return NextResponse.json(
        { error: 'This invitation has already been used or cancelled' },
        { status: 400 }
      )
    }

    // Check expiration
    if (new Date() > inv.expiresAt) {
      return NextResponse.json(
        { error: 'This invitation has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Return invitation details (limited info for security)
    // Transform UUIDs to TypeIDs in response (invitation table uses raw UUIDs)
    return NextResponse.json({
      id: fromUuid('invite', inv.id),
      email: inv.email,
      name: inv.name || null,
      role: inv.role,
      organizationName: inv.organization.name,
      inviterName: inv.inviter?.name || null,
    })
  } catch (error) {
    console.error('[Get Invitation] Error:', error)
    return NextResponse.json({ error: 'Failed to get invitation' }, { status: 500 })
  }
}
