import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'

/**
 * GET /api/organization/portal-auth?organizationId={id}
 *
 * Get portal authentication settings for an organization.
 * Requires owner or admin role.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can view portal auth settings
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({
      portalAuthEnabled: org.portalAuthEnabled,
      portalPasswordEnabled: org.portalPasswordEnabled,
      portalGoogleEnabled: org.portalGoogleEnabled,
      portalGithubEnabled: org.portalGithubEnabled,
      portalRequireAuth: org.portalRequireAuth,
      portalPublicVoting: org.portalPublicVoting,
      portalPublicCommenting: org.portalPublicCommenting,
    })
  } catch (error) {
    console.error('Error fetching portal auth settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/organization/portal-auth
 *
 * Update portal authentication settings for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
 *   portalAuthEnabled?: boolean,
 *   portalPasswordEnabled?: boolean,
 *   portalGoogleEnabled?: boolean,
 *   portalGithubEnabled?: boolean,
 *   portalRequireAuth?: boolean,
 *   portalPublicVoting?: boolean,
 *   portalPublicCommenting?: boolean,
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      organizationId,
      portalAuthEnabled,
      portalPasswordEnabled,
      portalGoogleEnabled,
      portalGithubEnabled,
      portalRequireAuth,
      portalPublicVoting,
      portalPublicCommenting,
    } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can update portal auth settings
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build update object with only provided fields
    const updates: Partial<{
      portalAuthEnabled: boolean
      portalPasswordEnabled: boolean
      portalGoogleEnabled: boolean
      portalGithubEnabled: boolean
      portalRequireAuth: boolean
      portalPublicVoting: boolean
      portalPublicCommenting: boolean
    }> = {}

    if (typeof portalAuthEnabled === 'boolean') {
      updates.portalAuthEnabled = portalAuthEnabled
    }
    if (typeof portalPasswordEnabled === 'boolean') {
      updates.portalPasswordEnabled = portalPasswordEnabled
    }
    if (typeof portalGoogleEnabled === 'boolean') {
      updates.portalGoogleEnabled = portalGoogleEnabled
    }
    if (typeof portalGithubEnabled === 'boolean') {
      updates.portalGithubEnabled = portalGithubEnabled
    }
    if (typeof portalRequireAuth === 'boolean') {
      updates.portalRequireAuth = portalRequireAuth
    }
    if (typeof portalPublicVoting === 'boolean') {
      updates.portalPublicVoting = portalPublicVoting
    }
    if (typeof portalPublicCommenting === 'boolean') {
      updates.portalPublicCommenting = portalPublicCommenting
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'At least one setting must be provided' }, { status: 400 })
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set(updates)
      .where(eq(organization.id, organizationId))
      .returning()

    return NextResponse.json({
      success: true,
      portalAuthEnabled: updated.portalAuthEnabled,
      portalPasswordEnabled: updated.portalPasswordEnabled,
      portalGoogleEnabled: updated.portalGoogleEnabled,
      portalGithubEnabled: updated.portalGithubEnabled,
      portalRequireAuth: updated.portalRequireAuth,
      portalPublicVoting: updated.portalPublicVoting,
      portalPublicCommenting: updated.portalPublicCommenting,
    })
  } catch (error) {
    console.error('Error updating portal auth settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
