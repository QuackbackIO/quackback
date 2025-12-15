import { NextResponse } from 'next/server'
import { organizationService } from '@quackback/domain'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'
import { toMemberId } from '@quackback/ids'

/**
 * GET /api/organization/custom-css?organizationId={id}
 *
 * Get custom CSS for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const result = await organizationService.getCustomCss(validation.organization.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 404)
    }

    return NextResponse.json({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/custom-css
 *
 * Update custom CSS for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
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

    const result = await organizationService.updateCustomCss(customCss, {
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
      customCss: result.value,
    })
  },
  { roles: ['owner', 'admin'] }
)
