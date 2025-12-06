import { NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

/**
 * GET /api/organization/security?organizationId={id}
 *
 * Get security and authentication settings for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, validation.organization.id),
    })

    if (!org) {
      throw new ApiError('Organization not found', 404)
    }

    return NextResponse.json({
      strictSsoMode: org.strictSsoMode,
      passwordAuthEnabled: org.passwordAuthEnabled,
      googleOAuthEnabled: org.googleOAuthEnabled,
      githubOAuthEnabled: org.githubOAuthEnabled,
      microsoftOAuthEnabled: org.microsoftOAuthEnabled,
    })
  },
  { roles: ['owner', 'admin'] }
)

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
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const {
      strictSsoMode,
      passwordAuthEnabled,
      googleOAuthEnabled,
      githubOAuthEnabled,
      microsoftOAuthEnabled,
    } = body

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
      throw new ApiError('At least one setting must be provided', 400)
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set(updates)
      .where(eq(organization.id, validation.organization.id))
      .returning()

    return successResponse({
      success: true,
      strictSsoMode: updated.strictSsoMode,
      passwordAuthEnabled: updated.passwordAuthEnabled,
      googleOAuthEnabled: updated.googleOAuthEnabled,
      githubOAuthEnabled: updated.githubOAuthEnabled,
      microsoftOAuthEnabled: updated.microsoftOAuthEnabled,
    })
  },
  { roles: ['owner', 'admin'] }
)
