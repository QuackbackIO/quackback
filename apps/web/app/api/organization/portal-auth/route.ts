import { NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import type { PermissionLevel } from '@quackback/db/types'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

const PERMISSION_LEVELS = ['anyone', 'authenticated', 'disabled'] as const

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return typeof value === 'string' && PERMISSION_LEVELS.includes(value as PermissionLevel)
}

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
      portalVoting: org.portalVoting,
      portalCommenting: org.portalCommenting,
      portalSubmissions: org.portalSubmissions,
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
 *   portalVoting?: 'anyone' | 'authenticated' | 'disabled',
 *   portalCommenting?: 'anyone' | 'authenticated' | 'disabled',
 *   portalSubmissions?: 'anyone' | 'authenticated' | 'disabled',
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
      portalVoting,
      portalCommenting,
      portalSubmissions,
    } = body

    // Build update object with only provided fields
    const updates: Partial<{
      portalAuthEnabled: boolean
      portalPasswordEnabled: boolean
      portalGoogleEnabled: boolean
      portalGithubEnabled: boolean
      portalVoting: PermissionLevel
      portalCommenting: PermissionLevel
      portalSubmissions: PermissionLevel
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
    if (isPermissionLevel(portalVoting)) {
      updates.portalVoting = portalVoting
    }
    if (isPermissionLevel(portalCommenting)) {
      updates.portalCommenting = portalCommenting
    }
    if (isPermissionLevel(portalSubmissions)) {
      updates.portalSubmissions = portalSubmissions
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
      portalVoting: updated.portalVoting,
      portalCommenting: updated.portalCommenting,
      portalSubmissions: updated.portalSubmissions,
    })
  },
  { roles: ['owner', 'admin'] }
)
