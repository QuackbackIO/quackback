import { NextRequest, NextResponse } from 'next/server'
import { workspaceService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'

/**
 * GET /api/auth/portal-auth-config?slug={orgSlug}
 *
 * Returns public portal authentication configuration for an organization.
 * This is used by the portal login form to know which auth methods to display.
 *
 * No authentication required - this is public information needed before login.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    }

    const result = await workspaceService.getPublicPortalConfig(slug)

    if (!result.success) {
      // Return default config if org not found
      return NextResponse.json({
        found: false,
        oauth: DEFAULT_PORTAL_CONFIG.oauth,
        features: DEFAULT_PORTAL_CONFIG.features,
      })
    }

    return NextResponse.json({
      found: true,
      oauth: result.value.oauth,
      features: result.value.features,
    })
  } catch (error) {
    console.error('Error fetching portal auth config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
