import { NextRequest, NextResponse } from 'next/server'
import { settingsService, DEFAULT_AUTH_CONFIG } from '@quackback/domain'

/**
 * GET /api/auth/org-auth-config?slug={orgSlug}
 *
 * Returns public authentication configuration for an organization.
 * This is used by the login form to know which auth methods to display.
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

    const result = await settingsService.getPublicAuthConfig()

    if (!result.success) {
      // Return default config if org not found (allows login to proceed with defaults)
      return NextResponse.json({
        found: false,
        oauth: DEFAULT_AUTH_CONFIG.oauth,
        openSignup: DEFAULT_AUTH_CONFIG.openSignup,
      })
    }

    return NextResponse.json({
      found: true,
      oauth: result.value.oauth,
      openSignup: result.value.openSignup,
    })
  } catch (error) {
    console.error('Error fetching org auth config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
