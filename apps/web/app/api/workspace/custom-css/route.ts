import { NextResponse } from 'next/server'
import { workspaceService } from '@quackback/domain'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

/**
 * GET /api/workspace/custom-css?workspaceId={id}
 *
 * Get custom CSS for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const result = await workspaceService.getCustomCss(validation.workspace.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 404)
    }

    return NextResponse.json({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/workspace/custom-css
 *
 * Update custom CSS for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   workspaceId: string,
 *   customCss: string | null
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { customCss } = body

    // Validate customCss - must be string or null
    if (customCss !== null && typeof customCss !== 'string') {
      throw new ApiError('customCss must be a string or null', 400)
    }

    const result = await workspaceService.updateCustomCss(customCss, {
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
      customCss: result.value,
    })
  },
  { roles: ['owner', 'admin'] }
)
