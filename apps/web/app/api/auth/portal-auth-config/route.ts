import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'

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

    // Find organization by slug
    const org = await db.query.organization.findFirst({
      where: eq(organization.slug, slug),
    })

    if (!org) {
      // Return default config if org not found
      return NextResponse.json({
        found: false,
        portalAuthEnabled: true,
        passwordEnabled: true,
        googleEnabled: true,
        githubEnabled: true,
        voting: 'anyone',
        commenting: 'anyone',
        submissions: 'authenticated',
      })
    }

    return NextResponse.json({
      found: true,
      organizationId: org.id,
      organizationName: org.name,
      portalAuthEnabled: org.portalAuthEnabled,
      passwordEnabled: org.portalPasswordEnabled,
      googleEnabled: org.portalGoogleEnabled,
      githubEnabled: org.portalGithubEnabled,
      voting: org.portalVoting,
      commenting: org.portalCommenting,
      submissions: org.portalSubmissions,
    })
  } catch (error) {
    console.error('Error fetching portal auth config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
