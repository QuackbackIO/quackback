import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { headers } from 'next/headers'

/**
 * Domain Verification Endpoint
 *
 * Serves verification tokens for custom domains.
 * When accessed via the custom domain, returns the expected token
 * so the verification API can confirm the domain routes correctly.
 *
 * Flow:
 * 1. User adds custom domain → we generate a verification token
 * 2. User creates CNAME pointing their domain to our app
 * 3. Verification API fetches this endpoint via the custom domain
 * 4. If token matches, domain is verified
 */

export async function GET(_request: NextRequest) {
  const headersList = await headers()
  const host = headersList.get('host')
  const xForwardedHost = headersList.get('x-forwarded-host')

  // Prefer x-forwarded-host if behind a proxy, otherwise use host
  const effectiveHost = xForwardedHost || host

  if (!effectiveHost) {
    return NextResponse.json({ error: 'No host header' }, { status: 400 })
  }

  // Strip port if present
  const domain = effectiveHost.split(':')[0].toLowerCase()

  // Look up the domain in our database
  const domainRecord = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.domain, domain),
  })

  if (!domainRecord) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  // Only serve token for unverified custom domains
  if (domainRecord.domainType !== 'custom') {
    return NextResponse.json({ error: 'Not a custom domain' }, { status: 400 })
  }

  if (domainRecord.verified) {
    return NextResponse.json({ verified: true, message: 'Domain is already verified' })
  }

  if (!domainRecord.verificationToken) {
    return NextResponse.json({ error: 'No verification token' }, { status: 400 })
  }

  // Auto-verify: if traffic is reaching this endpoint via the custom domain,
  // the CNAME is correctly configured. Mark as verified.
  await db
    .update(workspaceDomain)
    .set({ verified: true, verificationToken: null })
    .where(eq(workspaceDomain.id, domainRecord.id))

  // Return success - domain is now verified
  return NextResponse.json({
    verified: true,
    message: 'Domain automatically verified',
    domain: domain,
  })
}
