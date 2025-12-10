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
      portalGoogleEnabled: org.portalGoogleEnabled,
      portalGithubEnabled: org.portalGithubEnabled,
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
 *   portalGoogleEnabled?: boolean,
 *   portalGithubEnabled?: boolean,
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { portalGoogleEnabled, portalGithubEnabled } = body

    // Build update object with only provided fields
    const updates: Partial<{
      portalGoogleEnabled: boolean
      portalGithubEnabled: boolean
    }> = {}

    if (typeof portalGoogleEnabled === 'boolean') {
      updates.portalGoogleEnabled = portalGoogleEnabled
    }
    if (typeof portalGithubEnabled === 'boolean') {
      updates.portalGithubEnabled = portalGithubEnabled
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
      portalGoogleEnabled: updated.portalGoogleEnabled,
      portalGithubEnabled: updated.portalGithubEnabled,
    })
  },
  { roles: ['owner', 'admin'] }
)
