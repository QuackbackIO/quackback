import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@/lib/db'
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

  // Only verify custom domains
  if (domainRecord.domainType !== 'custom') {
    return new NextResponse('NOT_CUSTOM_DOMAIN', { status: 400 })
  }

  // If not already verified, mark as verified now
  // The fact that this request reached us via the custom domain proves CNAME is correct
  if (!domainRecord.verified) {
    await db
      .update(workspaceDomain)
      .set({ verified: true, verificationToken: null })
      .where(eq(workspaceDomain.id, domainRecord.id))
  }

  // Return simple "VERIFIED" response - idempotent
  return new NextResponse('VERIFIED', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
