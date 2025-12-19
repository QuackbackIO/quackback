import { withApiHandlerParams, ApiError, successResponse, parseId } from '@/lib/api-handler'
import { getUserService } from '@/lib/services'

type RouteParams = { memberId: string }

/**
 * GET /api/admin/users/[memberId]
 *
 * Get detailed information about a portal user including their activity.
 * Portal users have role='user' in the member table.
 */
export const GET = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    // Parse TypeID to UUID for database query
    const memberId = parseId(params.memberId, 'member')

    const result = await getUserService().getPortalUserDetail(memberId, validation.workspace.id)

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
 * DELETE /api/admin/users/[memberId]
 *
 * Remove a portal user from the organization.
 * This deletes their member record and org-scoped user account.
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    // Parse TypeID to UUID for database query
    const memberId = parseId(params.memberId, 'member')

    const result = await getUserService().removePortalUser(memberId, validation.workspace.id)

    if (!result.success) {
      const error = result.error
      switch (error.code) {
        case 'MEMBER_NOT_FOUND':
          throw new ApiError(error.message, 404)
        default:
          throw new ApiError(error.message, 500)
      }
    }

    return successResponse({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
