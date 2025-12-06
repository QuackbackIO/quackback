import { NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

/**
 * GET /api/organization/portal-auth?organizationId={id}
 *
 * Get portal authentication settings for an organization.
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
      portalAuthEnabled: org.portalAuthEnabled,
      portalPasswordEnabled: org.portalPasswordEnabled,
      portalGoogleEnabled: org.portalGoogleEnabled,
      portalGithubEnabled: org.portalGithubEnabled,
      portalRequireAuth: org.portalRequireAuth,
      portalPublicVoting: org.portalPublicVoting,
      portalPublicCommenting: org.portalPublicCommenting,
    })
  },
  { roles: ['owner', 'admin'] }
)

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
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const {
      portalAuthEnabled,
      portalPasswordEnabled,
      portalGoogleEnabled,
      portalGithubEnabled,
      portalRequireAuth,
      portalPublicVoting,
      portalPublicCommenting,
    } = body

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
      portalAuthEnabled: updated.portalAuthEnabled,
      portalPasswordEnabled: updated.portalPasswordEnabled,
      portalGoogleEnabled: updated.portalGoogleEnabled,
      portalGithubEnabled: updated.portalGithubEnabled,
      portalRequireAuth: updated.portalRequireAuth,
      portalPublicVoting: updated.portalPublicVoting,
      portalPublicCommenting: updated.portalPublicCommenting,
    })
  },
  { roles: ['owner', 'admin'] }
)
