import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { requireRole, forbiddenResponse } from '@/lib/api-handler'
import { theme } from '@quackback/shared'

// Re-export type for consumers
export type { ThemeConfig } from '@quackback/shared/theme'

/**
 * GET /api/organization/theme?organizationId={id}
 *
 * Get theme configuration for an organization.
 * Requires owner or admin role.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can view theme settings
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return forbiddenResponse()
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const themeConfig = theme.parseThemeConfig(org.themeConfig) || {}

    return NextResponse.json({ themeConfig })
  } catch (error) {
    console.error('Error fetching theme settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, themeConfig } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can update theme settings
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
      return forbiddenResponse()
    }

    // Validate themeConfig structure
    if (themeConfig && typeof themeConfig !== 'object') {
      return NextResponse.json({ error: 'Invalid themeConfig structure' }, { status: 400 })
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set({ themeConfig: themeConfig ? theme.serializeThemeConfig(themeConfig) : null })
      .where(eq(organization.id, organizationId))
      .returning()

    return NextResponse.json({
      success: true,
      themeConfig: theme.parseThemeConfig(updated.themeConfig) || {},
    })
  } catch (error) {
    console.error('Error updating theme settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
