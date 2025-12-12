import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { auth } from '@/lib/auth'
import { Resolver } from 'dns/promises'

/**
 * Domain Verification API
 *
 * Verifies custom domain ownership via CNAME record.
 * Users must create a CNAME pointing their domain to APP_DOMAIN.
 * This proves ownership AND sets up routing in one step.
 */

const resolver = new Resolver()
// Use public DNS servers for consistent results
resolver.setServers(['8.8.8.8', '1.1.1.1'])

function getCnameTarget(): string {
  const appDomain = process.env.APP_DOMAIN
  if (!appDomain) {
    throw new Error('APP_DOMAIN is required')
  }
  return appDomain
}

interface DnsCheckResult {
  verified: boolean
  currentValue: string | null
  error: string | null
}

async function checkCnameVerification(domain: string): Promise<DnsCheckResult> {
  const expectedTarget = getCnameTarget().toLowerCase()

  try {
    const records = await resolver.resolveCname(domain)

    if (records.length === 0) {
      return { verified: false, currentValue: null, error: 'No CNAME record found' }
    }

    // Check if any CNAME record points to our domain
    for (const record of records) {
      // CNAME records may have trailing dot, normalize both
      const normalizedRecord = record.toLowerCase().replace(/\.$/, '')
      if (normalizedRecord === expectedTarget) {
        return { verified: true, currentValue: normalizedRecord, error: null }
      }
    }

    // CNAME exists but points elsewhere
    const currentValue = records[0].toLowerCase().replace(/\.$/, '')
    return { verified: false, currentValue, error: null }
  } catch (error) {
    // DNS lookup failed (NXDOMAIN, no CNAME, timeout, etc.)
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'ENODATA' || errorCode === 'ENOTFOUND') {
      return { verified: false, currentValue: null, error: 'No DNS record found' }
    }
    console.error(`CNAME verification failed for ${domain}:`, error)
    return { verified: false, currentValue: null, error: 'DNS lookup failed' }
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

  // Check CNAME record
  const result = await checkCnameVerification(domain.domain)
  const cnameTarget = getCnameTarget()

  if (result.verified) {
    // Mark as verified
    await db
      .update(workspaceDomain)
      .set({ verified: true, verificationToken: null })
      .where(eq(workspaceDomain.id, domainId))

    return NextResponse.json({
      verified: true,
      message: 'Domain verified successfully',
    })
  }

  // Return diagnostic info for troubleshooting
  return NextResponse.json({
    verified: false,
    dns: {
      found: result.currentValue !== null,
      currentValue: result.currentValue,
      expectedValue: cnameTarget,
      error: result.error,
    },
    expectedRecord: {
      type: 'CNAME',
      name: domain.domain,
      value: cnameTarget,
    },
  })
}
