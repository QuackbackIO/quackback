import { NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'
import { theme } from '@quackback/shared'

// Re-export type for consumers
export type { ThemeConfig } from '@quackback/shared/theme'

/**
 * GET /api/organization/theme?organizationId={id}
 *
 * Get theme configuration for an organization.
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

    const themeConfig = theme.parseThemeConfig(org.themeConfig) || {}
    return NextResponse.json({ themeConfig })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/theme
 *
 * Update theme configuration for an organization.
 * Requires owner or admin role.
 *
 * Body: {
 *   organizationId: string,
 *   themeConfig: ThemeConfig
 * }
 */
export const PATCH = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { themeConfig } = body

    // Validate themeConfig structure
    if (themeConfig && typeof themeConfig !== 'object') {
      throw new ApiError('Invalid themeConfig structure', 400)
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set({ themeConfig: themeConfig ? theme.serializeThemeConfig(themeConfig) : null })
      .where(eq(organization.id, validation.organization.id))
      .returning()

    return successResponse({
      success: true,
      themeConfig: theme.parseThemeConfig(updated.themeConfig) || {},
    })
  },
  { roles: ['owner', 'admin'] }
)
