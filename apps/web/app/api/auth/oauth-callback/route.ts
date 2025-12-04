import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { auth } from '@/lib/auth'
import { db, sessionTransferToken } from '@quackback/db'
import { getBaseDomain } from '@/lib/routing'

/**
 * Verify HMAC signature for OAuth state (timing-safe comparison)
 */
function verifyState(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex')
  if (signature.length !== expectedSignature.length) return false
  let result = 0
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }
  return result === 0
}

/**
 * OAuth Callback Handler for Tenant Isolation
 *
 * This endpoint is called after Better-Auth completes OAuth authentication.
 * It validates the signed state, creates a one-time transfer token, and redirects to the target subdomain.
 *
 * Security:
 * - Verifies HMAC signature on oauth_target cookie (prevents tampering)
 * - Checks timestamp to prevent replay attacks
 * - Validates subdomain format
 */
export async function GET(request: NextRequest) {
  try {
    // Get auth secret for signature verification
    const secret = process.env.BETTER_AUTH_SECRET
    if (!secret) {
      return NextResponse.redirect(new URL('/?error=server_config', request.url))
    }

    // Get and validate oauth_target cookie
    const oauthTargetCookie = request.cookies.get('oauth_target')
    if (!oauthTargetCookie) {
      return NextResponse.redirect(new URL('/?error=oauth_missing_target', request.url))
    }

    // Parse signed state from cookie
    let parsedCookie: { payload: string; signature: string }
    try {
      parsedCookie = JSON.parse(oauthTargetCookie.value)
    } catch {
      return NextResponse.redirect(new URL('/?error=oauth_invalid_state', request.url))
    }

    const { payload, signature } = parsedCookie
    if (!payload || !signature) {
      return NextResponse.redirect(new URL('/?error=oauth_invalid_state', request.url))
    }

    // Verify HMAC signature (prevents tampering)
    if (!verifyState(payload, signature, secret)) {
      return NextResponse.redirect(new URL('/?error=oauth_invalid_signature', request.url))
    }

    // Parse the verified payload
    const { subdomain, context, timestamp } = JSON.parse(payload)

    // Check timestamp (5 minute window to prevent replay)
    const maxAge = 5 * 60 * 1000
    if (Date.now() - timestamp > maxAge) {
      return NextResponse.redirect(new URL('/?error=oauth_expired', request.url))
    }

    // Validate subdomain format
    if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
      return NextResponse.redirect(new URL('/?error=oauth_invalid_subdomain', request.url))
    }

    // Get the current session from Better-Auth
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user) {
      return redirectToSubdomainError(subdomain, 'oauth_failed', request)
    }

    // Create a one-time transfer token
    const token = generateSecureToken()
    const tokenId = crypto.randomUUID()

    // Build redirect URL to subdomain
    const subdomainUrl = buildSubdomainUrl(subdomain, '/api/auth/trust-login', request)
    const targetDomain = subdomainUrl.host // Full domain e.g. "acme.localhost:3000"

    await db.insert(sessionTransferToken).values({
      id: tokenId,
      token,
      userId: session.user.id,
      targetDomain,
      callbackUrl: context === 'portal' ? '/' : '/admin',
      context: context || 'team',
      expiresAt: new Date(Date.now() + 30000), // 30 seconds
    })
    subdomainUrl.searchParams.set('token', token)

    // Create response that clears cookies and redirects
    const response = NextResponse.redirect(subdomainUrl)
    response.cookies.delete('oauth_target')
    response.cookies.delete('better-auth.session_token')

    return response
  } catch {
    return NextResponse.redirect(new URL('/?error=oauth_error', request.url))
  }
}

/**
 * Generate a secure random token
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build a URL for a subdomain using request origin
 *
 * example.com -> acme.example.com
 * localhost:3000 -> acme.localhost:3000
 */
function buildSubdomainUrl(subdomain: string, path: string, request: NextRequest): URL {
  const host = request.headers.get('host')
  if (!host) {
    throw new Error('Missing host header')
  }
  const baseDomain = getBaseDomain(host)
  const protocol = request.headers.get('x-forwarded-proto') || 'http'
  const url = new URL(`${protocol}://${subdomain}.${baseDomain}${path}`)
  return url
}

/**
 * Redirect to subdomain with error
 */
function redirectToSubdomainError(
  subdomain: string,
  error: string,
  request: NextRequest
): NextResponse {
  const url = buildSubdomainUrl(subdomain, '/login', request)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}
