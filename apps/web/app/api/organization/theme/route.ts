import { NextResponse } from 'next/server'
import { organizationService, type BrandingConfig } from '@quackback/domain'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

// Re-export type for consumers
export type { BrandingConfig } from '@quackback/domain'

/**
 * GET /api/organization/theme?organizationId={id}
 *
 * Get branding/theme configuration for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const result = await organizationService.getBrandingConfig(validation.organization.id)

    if (!result.success) {
      throw new ApiError(result.error.message, 404)
    }

    return NextResponse.json({ brandingConfig: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/theme
 *
 * Update branding/theme configuration for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
 *   brandingConfig: BrandingConfig
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { brandingConfig } = body

    // Validate brandingConfig structure
    if (brandingConfig && typeof brandingConfig !== 'object') {
      throw new ApiError('Invalid brandingConfig structure', 400)
    }

    const result = await organizationService.updateBrandingConfig(
      (brandingConfig || {}) as BrandingConfig,
      {
        userId: validation.user.id,
        organizationId: validation.organization.id,
        memberId: validation.member.id,
        memberRole: validation.member.role as 'owner' | 'admin' | 'member' | 'user',
        userName: validation.user.name ?? '',
        userEmail: validation.user.email,
      }
    )

    if (!result.success) {
      throw new ApiError(result.error.message, 400)
    }

    return successResponse({
      success: true,
      brandingConfig: result.value,
    })
  },
  { roles: ['owner', 'admin'] }
)
