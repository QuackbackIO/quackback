import { NextRequest, NextResponse } from 'next/server'
import { db, organization, ssoProvider, eq } from '@quackback/db'

/**
 * GET /api/auth/org-auth-config?slug={orgSlug}
 *
 * Returns public authentication configuration for an organization.
 * This is used by the login form to know which auth methods to display.
 *
 * No authentication required - this is public information needed before login.
 *
 * Note: Password authentication has been removed in favor of magic OTP codes.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    }

    // Find organization by slug
    const org = await db.query.organization.findFirst({
      where: eq(organization.slug, slug),
    })

    if (!org) {
      // Return default config if org not found (allows login to proceed with defaults)
      return NextResponse.json({
        found: false,
        googleEnabled: true,
        githubEnabled: true,
        microsoftEnabled: true,
        openSignupEnabled: false,
        ssoProviders: [],
      })
    }

    // Get SSO providers for this organization
    const providers = await db.query.ssoProvider.findMany({
      where: eq(ssoProvider.organizationId, org.id),
      columns: {
        providerId: true,
        issuer: true,
        domain: true,
      },
    })

    return NextResponse.json({
      found: true,
      organizationId: org.id,
      organizationName: org.name,
      googleEnabled: org.googleOAuthEnabled,
      githubEnabled: org.githubOAuthEnabled,
      microsoftEnabled: org.microsoftOAuthEnabled,
      openSignupEnabled: org.openSignupEnabled,
      ssoProviders: providers.map((p) => ({
        providerId: p.providerId,
        issuer: p.issuer,
        domain: p.domain,
      })),
    })
  } catch (error) {
    console.error('Error fetching org auth config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
