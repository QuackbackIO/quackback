import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { auth } from '@/lib/auth'
import { Resolver } from 'dns/promises'

/**
 * Domain Verification API
 *
 * Verifies custom domain ownership via DNS TXT record.
 * Users must add a TXT record: _quackback.{domain} = quackback-verify={token}
 */

const resolver = new Resolver()
// Use public DNS servers for consistent results
resolver.setServers(['8.8.8.8', '1.1.1.1'])

async function checkDnsVerification(domain: string, expectedToken: string): Promise<boolean> {
  const txtHost = `_quackback.${domain}`

  try {
    const records = await resolver.resolveTxt(txtHost)

    // records is array of arrays (each TXT record can have multiple strings)
    for (const record of records) {
      const txtValue = record.join('')
      if (txtValue === `quackback-verify=${expectedToken}`) {
        return true
      }
    }

    return false
  } catch (error) {
    // DNS lookup failed (NXDOMAIN, timeout, etc.)
    console.error(`DNS verification failed for ${domain}:`, error)
    return false
  }
}

/**
 * POST /api/domains/verify - Verify a custom domain via DNS
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const domainId = body.domainId

  if (!domainId || typeof domainId !== 'string') {
    return NextResponse.json({ error: 'domainId is required' }, { status: 400 })
  }

  // Get the domain with org membership check
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      organization: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id),
          },
        },
      },
    },
  })

  if (!domain) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  // Verify user is admin/owner
  const member = domain.organization.members[0]
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Already verified
  if (domain.verified) {
    return NextResponse.json({ verified: true, message: 'Domain is already verified' })
  }

  // Must have a verification token
  if (!domain.verificationToken) {
    return NextResponse.json({ error: 'Domain has no verification token' }, { status: 400 })
  }

  // Check DNS
  const isVerified = await checkDnsVerification(domain.domain, domain.verificationToken)

  if (isVerified) {
    // Mark as verified and clear token
    await db
      .update(workspaceDomain)
      .set({ verified: true, verificationToken: null })
      .where(eq(workspaceDomain.id, domainId))

    return NextResponse.json({ verified: true, message: 'Domain verified successfully' })
  }

  return NextResponse.json({
    verified: false,
    message:
      'DNS record not found. Please ensure you have added the TXT record and wait for DNS propagation.',
    expectedRecord: {
      type: 'TXT',
      name: `_quackback.${domain.domain}`,
      value: `quackback-verify=${domain.verificationToken}`,
    },
  })
}
