import { NextRequest, NextResponse } from 'next/server'
import { db, workspaceDomain, eq } from '@quackback/db'
import { auth } from '@/lib/auth'

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

async function checkHttpVerification(
  domain: string,
  expectedToken: string
): Promise<HttpCheckResult> {
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

    const token = await response.text()
    const tokenMatches = token.trim() === expectedToken

    if (!tokenMatches) {
      // Log for debugging
      const debugDomain = response.headers.get('x-verified-domain')
      const debugDomainId = response.headers.get('x-domain-id')
      console.error('Domain verification token mismatch:', {
        requestedDomain: new URL(url).hostname,
        resolvedDomain: debugDomain,
        resolvedDomainId: debugDomainId,
        expectedTokenPrefix: expectedToken.substring(0, 10) + '...',
        receivedTokenPrefix: token.trim().substring(0, 10) + '...',
      })
    }

    return {
      verified: tokenMatches,
      reachable: true,
      tokenMatch: tokenMatches,
      error: tokenMatches ? null : 'Token mismatch - domain may be pointing to wrong organization',
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

  // Need verification token for HTTP check
  if (!domain.verificationToken) {
    return NextResponse.json({ error: 'Domain has no verification token' }, { status: 400 })
  }

  // Check via HTTP
  const result = await checkHttpVerification(domain.domain, domain.verificationToken)

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
