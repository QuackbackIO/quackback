import { NextResponse } from 'next/server'
import { organizationService } from '@quackback/domain'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'
import { toMemberId } from '@quackback/ids'

/**
 * GET /api/organization/portal-auth?organizationId={id}
 *
 * Get portal configuration for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const result = await organizationService.getPortalConfig(validation.organization.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 404)
    }

    return NextResponse.json({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/portal-auth
 *
 * Update portal configuration for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
 *   oauth?: { google?: boolean, github?: boolean },
 *   features?: { publicView?: boolean, submissions?: boolean, comments?: boolean, voting?: boolean },
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { oauth, features } = body

    // Build update input with only provided fields
    const input: {
      oauth?: { google?: boolean; github?: boolean }
      features?: {
        publicView?: boolean
        submissions?: boolean
        comments?: boolean
        voting?: boolean
      }
    } = {}

    if (oauth && typeof oauth === 'object') {
      input.oauth = {}
      if (typeof oauth.google === 'boolean') input.oauth.google = oauth.google
      if (typeof oauth.github === 'boolean') input.oauth.github = oauth.github
    }
    if (features && typeof features === 'object') {
      input.features = {}
      if (typeof features.publicView === 'boolean') input.features.publicView = features.publicView
      if (typeof features.submissions === 'boolean')
        input.features.submissions = features.submissions
      if (typeof features.comments === 'boolean') input.features.comments = features.comments
      if (typeof features.voting === 'boolean') input.features.voting = features.voting
    }

    if (Object.keys(input).length === 0) {
      throw new ApiError('At least one setting must be provided', 400)
    }

    const result = await organizationService.updatePortalConfig(input, {
      userId: validation.user.id,
      organizationId: validation.organization.id,
      memberId: toMemberId(validation.member.id),
      memberRole: validation.member.role as 'owner' | 'admin' | 'member' | 'user',
      userName: validation.user.name ?? '',
      userEmail: validation.user.email,
    })

    if (!result.success) {
      throw new ApiError(result.error.message, 400)
    }

    return successResponse({
      success: true,
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)
