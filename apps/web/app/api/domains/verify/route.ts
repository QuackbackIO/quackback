import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { auth } from '@/lib/auth'
import { isValidTypeId, type DomainId } from '@quackback/ids'
import { isCloud } from '@quackback/domain/features'
import { isCloudflareConfigured } from '@quackback/ee/cloudflare'

/**
 * Domain Verification API
 *
 * Verifies custom domain ownership via HTTP check.
 * Users must create a CNAME pointing their domain to APP_DOMAIN.
 * We then fetch /.well-known/domain-verification from their domain
 * to confirm routing works and the token matches.
 *
 * This approach works even with Cloudflare and other proxies.
 */

interface HttpCheckResult {
  verified: boolean
  reachable: boolean
  tokenMatch: boolean | null
  error: string | null
}

const MAX_REDIRECTS = 5

async function checkHttpVerification(domain: string): Promise<HttpCheckResult> {
  let url = `https://${domain}/.well-known/domain-verification`
  const visitedUrls = new Set<string>()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    let response: Response
    let redirectCount = 0

    // Manually follow redirects with loop detection and limit
    while (true) {
      // Check for redirect loop
      if (visitedUrls.has(url)) {
        clearTimeout(timeoutId)
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Redirect loop detected.',
        }
      }
      visitedUrls.add(url)

      // Check redirect limit
      if (redirectCount >= MAX_REDIRECTS) {
        clearTimeout(timeoutId)
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Too many redirects.',
        }
      }

      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Quackback-Domain-Verification/1.0',
        },
        redirect: 'manual',
      })

      // Check if redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          clearTimeout(timeoutId)
          return {
            verified: false,
            reachable: true,
            tokenMatch: null,
            error: `Redirect without location header (status ${response.status})`,
          }
        }

        // Resolve relative URLs
        url = new URL(location, url).href
        redirectCount++

        // Ensure we stay on the same domain
        const redirectHost = new URL(url).hostname.toLowerCase()
        if (redirectHost !== domain.toLowerCase()) {
          clearTimeout(timeoutId)
          return {
            verified: false,
            reachable: true,
            tokenMatch: null,
            error: `Domain redirected to ${redirectHost}. CNAME may be misconfigured.`,
          }
        }

        continue
      }

      // Not a redirect, we have our final response
      break
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Verification endpoint not found. Make sure your CNAME is set up correctly.',
        }
      }
      return {
        verified: false,
        reachable: true,
        tokenMatch: null,
        error: `Endpoint returned status ${response.status}`,
      }
    }

    const responseText = (await response.text()).trim()

    // The .well-known endpoint returns "VERIFIED" if the domain is valid
    // This is idempotent - it auto-verifies on first request and confirms on subsequent ones
    const isVerified = responseText === 'VERIFIED'

    return {
      verified: isVerified,
      reachable: true,
      tokenMatch: isVerified,
      error: isVerified ? null : `Unexpected response: ${responseText.substring(0, 50)}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check for specific error types
    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'Connection timed out. Check your DNS settings.',
      }
    }

    if (
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('getaddrinfo') ||
      errorMessage.includes('DNS')
    ) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'Domain not found. Create a CNAME record pointing to our servers.',
      }
    }

    if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'SSL certificate error. This may resolve automatically after DNS propagates.',
      }
    }

    console.error(`HTTP verification failed for ${domain}:`, error)
    return {
      verified: false,
      reachable: false,
      tokenMatch: null,
      error: 'Could not reach domain. Check your CNAME configuration.',
    }
  }
}

/**
 * POST /api/domains/verify - Verify a custom domain via HTTP check
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const domainIdParam = body.domainId

  if (
    !domainIdParam ||
    typeof domainIdParam !== 'string' ||
    !isValidTypeId(domainIdParam, 'domain')
  ) {
    return NextResponse.json({ error: 'domainId is required' }, { status: 400 })
  }
  const domainId = domainIdParam as DomainId

  // Get the domain with org membership check
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.id, domainId),
    with: {
      organization: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, session.user.id as `user_${string}`),
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

  // If Cloudflare is managing this domain, skip HTTP verification
  // UI should poll /api/domains/status for real-time CF status updates
  if (isCloud() && isCloudflareConfigured() && domain.cloudflareHostnameId) {
    return NextResponse.json({
      verified: false,
      sslStatus: domain.sslStatus,
      ownershipStatus: domain.ownershipStatus,
      message:
        domain.sslStatus === 'active'
          ? 'Domain verified via Cloudflare'
          : 'Waiting for Cloudflare SSL provisioning. Set up your CNAME record to proceed.',
      mode: 'cloudflare',
    })
  }

  // Self-hosted: Check via HTTP - the .well-known endpoint will auto-verify if reachable
  const result = await checkHttpVerification(domain.domain)

  if (result.verified) {
    // Mark as verified and clear the token
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
    check: {
      reachable: result.reachable,
      tokenMatch: result.tokenMatch,
      error: result.error,
    },
  })
}
