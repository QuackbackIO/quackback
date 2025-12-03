import { NextRequest, NextResponse } from 'next/server'
import { db, ssoProvider, eq } from '@quackback/db'

/**
 * POST /api/auth/sso-check
 *
 * Check if an email domain has SSO configured.
 * This is used by the login form to detect if a user should use SSO.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Extract domain from email
    const emailParts = email.split('@')
    if (emailParts.length !== 2) {
      return NextResponse.json({ hasSso: false })
    }

    const domain = emailParts[1].toLowerCase()

    // Look up SSO provider by domain
    const provider = await db.query.ssoProvider.findFirst({
      where: eq(ssoProvider.domain, domain),
    })

    if (!provider) {
      return NextResponse.json({ hasSso: false })
    }

    // Return provider info (don't expose sensitive config)
    return NextResponse.json({
      hasSso: true,
      providerId: provider.providerId,
      issuer: provider.issuer,
      domain: provider.domain,
    })
  } catch (error) {
    console.error('Error checking SSO:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
