import { NextResponse } from 'next/server'
import { workspaceService } from '@quackback/domain'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

/**
 * GET /api/workspace/security?workspaceId={id}
 *
 * Get authentication settings for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const result = await workspaceService.getAuthConfig(validation.workspace.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 404)
    }

    return NextResponse.json({
      oauth: result.value.oauth,
      ssoRequired: result.value.ssoRequired,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/workspace/security
 *
 * Update authentication settings for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   workspaceId: string,
 *   oauth?: { google?: boolean, github?: boolean, microsoft?: boolean },
 *   ssoRequired?: boolean,
 *   openSignup?: boolean,
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { oauth, ssoRequired, openSignup } = body

    // Build update input with only provided fields
    const input: {
      oauth?: { google?: boolean; github?: boolean; microsoft?: boolean }
      ssoRequired?: boolean
      openSignup?: boolean
    } = {}

    if (oauth && typeof oauth === 'object') {
      input.oauth = {}
      if (typeof oauth.google === 'boolean') input.oauth.google = oauth.google
      if (typeof oauth.github === 'boolean') input.oauth.github = oauth.github
      if (typeof oauth.microsoft === 'boolean') input.oauth.microsoft = oauth.microsoft
    }
    if (typeof ssoRequired === 'boolean') {
      input.ssoRequired = ssoRequired
    }
    if (typeof openSignup === 'boolean') {
      input.openSignup = openSignup
    }

    if (Object.keys(input).length === 0) {
      throw new ApiError('At least one setting must be provided', 400)
    }

    const result = await workspaceService.updateAuthConfig(input, {
      userId: validation.user.id,
      workspaceId: validation.workspace.id,
      memberId: validation.member.id,
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
      ssoRequired: result.value.ssoRequired,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)
