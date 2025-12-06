import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { requireRole, forbiddenResponse, errorResponse } from '@/lib/api-handler'

/**
 * GET /api/organization/security?organizationId={id}
 *
 * Get security and authentication settings for an organization.
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

    // Only owners and admins can view security settings
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return forbiddenResponse()
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({
      strictSsoMode: org.strictSsoMode,
      passwordAuthEnabled: org.passwordAuthEnabled,
      googleOAuthEnabled: org.googleOAuthEnabled,
      githubOAuthEnabled: org.githubOAuthEnabled,
      microsoftOAuthEnabled: org.microsoftOAuthEnabled,
    })
  } catch (error) {
    console.error('Error fetching organization security settings:', error)
    return errorResponse('Internal server error')
  }
}

/**
 * PATCH /api/organization/security
 *
 * Update security and authentication settings for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
 *   strictSsoMode?: boolean,
 *   passwordAuthEnabled?: boolean,
 *   googleOAuthEnabled?: boolean,
 *   githubOAuthEnabled?: boolean,
 *   microsoftOAuthEnabled?: boolean,
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      organizationId,
      strictSsoMode,
      passwordAuthEnabled,
      googleOAuthEnabled,
      githubOAuthEnabled,
      microsoftOAuthEnabled,
    } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can update security settings
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return forbiddenResponse()
    }

    // Build update object with only provided fields
    const updates: Partial<{
      strictSsoMode: boolean
      passwordAuthEnabled: boolean
      googleOAuthEnabled: boolean
      githubOAuthEnabled: boolean
      microsoftOAuthEnabled: boolean
    }> = {}

    if (typeof strictSsoMode === 'boolean') {
      updates.strictSsoMode = strictSsoMode
    }
    if (typeof passwordAuthEnabled === 'boolean') {
      updates.passwordAuthEnabled = passwordAuthEnabled
    }
    if (typeof googleOAuthEnabled === 'boolean') {
      updates.googleOAuthEnabled = googleOAuthEnabled
    }
    if (typeof githubOAuthEnabled === 'boolean') {
      updates.githubOAuthEnabled = githubOAuthEnabled
    }
    if (typeof microsoftOAuthEnabled === 'boolean') {
      updates.microsoftOAuthEnabled = microsoftOAuthEnabled
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
      strictSsoMode: updated.strictSsoMode,
      passwordAuthEnabled: updated.passwordAuthEnabled,
      googleOAuthEnabled: updated.googleOAuthEnabled,
      githubOAuthEnabled: updated.githubOAuthEnabled,
      microsoftOAuthEnabled: updated.microsoftOAuthEnabled,
    })
  } catch (error) {
    console.error('Error updating organization security settings:', error)
    return errorResponse('Internal server error')
  }
}
