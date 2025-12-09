import { withApiHandlerParams, ApiError, successResponse } from '@/lib/api-handler'
import { getUserService } from '@/lib/services'
import { z } from 'zod'

type RouteParams = { memberId: string }

const updateRoleSchema = z.object({
  role: z.enum(['user', 'member', 'admin', 'owner']),
})

/**
 * GET /api/admin/users/[memberId]
 *
 * Get detailed information about a portal user including their activity.
 */
export const GET = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    const { memberId } = params

    const result = await getUserService().getPortalUserDetail(memberId, validation.organization.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 500)
    }

    if (!result.value) {
      throw new ApiError('User not found', 404)
    }

    return successResponse(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * PATCH /api/admin/users/[memberId]
 *
 * Update a member's role. Only owners and admins can change roles.
 */
export const PATCH = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    const { memberId } = params
    const body = await request.json()

    // Validate role
    const parseResult = updateRoleSchema.safeParse(body)
    if (!parseResult.success) {
      throw new ApiError(parseResult.error.issues[0]?.message || 'Invalid role', 400)
    }

    const { role } = parseResult.data

    const result = await getUserService().updateMemberRole(
      memberId,
      role,
      validation.organization.id,
      validation.member.id
    )

    if (!result.success) {
      const error = result.error
      switch (error.code) {
        case 'MEMBER_NOT_FOUND':
          throw new ApiError(error.message, 404)
        case 'UNAUTHORIZED':
          throw new ApiError(error.message, 403)
        case 'CANNOT_CHANGE_OWN_ROLE':
        case 'INVALID_ROLE':
          throw new ApiError(error.message, 400)
        default:
          throw new ApiError(error.message, 500)
      }
    }

    return successResponse(result.value)
  },
  { roles: ['owner', 'admin'] }
)

/**
 * DELETE /api/admin/users/[memberId]
 *
 * Remove a member from the organization. Only owners and admins can remove members.
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    const { memberId } = params

    const result = await getUserService().removeMember(
      memberId,
      validation.organization.id,
      validation.member.id
    )

    if (!result.success) {
      const error = result.error
      switch (error.code) {
        case 'MEMBER_NOT_FOUND':
          throw new ApiError(error.message, 404)
        case 'UNAUTHORIZED':
          throw new ApiError(error.message, 403)
        case 'CANNOT_REMOVE_OWNER':
          throw new ApiError(error.message, 400)
        default:
          throw new ApiError(error.message, 500)
      }
    }

    return successResponse({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
