import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomBytes } from 'crypto'
import { organizationService, DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'

/**
 * Generate HMAC signature for OAuth state
 */
function signState(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

/**
 * Check if an OAuth provider is enabled for the given auth config and context.
 */
function isProviderEnabled(
  authConfig: { oauth: { google: boolean; github: boolean; microsoft?: boolean } },
  portalConfig: { oauth: { google: boolean; github: boolean } },
  provider: string,
  context: 'team' | 'portal'
): boolean {
  if (context === 'team') {
    switch (provider) {
      case 'google':
        return authConfig.oauth.google
      case 'github':
        return authConfig.oauth.github
      case 'microsoft':
        return authConfig.oauth.microsoft ?? false
      default:
        return false
    }
  } else {
    // Portal context
    switch (provider) {
      case 'google':
        return portalConfig.oauth.google
      case 'github':
        return portalConfig.oauth.github
      case 'microsoft':
        return false // Microsoft not supported for portal users
      default:
        return false
    }
  }
}

/**
 * OAuth Initiation Handler for Tenant Isolation
 *
 * This endpoint is called from tenant subdomains to initiate OAuth on the main domain.
 * It stores the target subdomain in a cookie so the callback knows where to redirect.
 *
 * Security:
 * - Validates that the OAuth provider is enabled for the organization
 * - Uses HMAC-signed state parameter to prevent CSRF attacks on OAuth flow
 *
 * Flow:
 * 1. User on acme.localhost/login clicks "Sign in with Google"
 * 2. Redirects to localhost/api/auth/oauth/google?subdomain=acme&callback=/admin
 * 3. This handler validates org settings, stores subdomain + nonce in signed cookie
 * 4. After OAuth, callback handler verifies signature and redirects to subdomain
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const { searchParams } = new URL(request.url)
  const subdomain = searchParams.get('subdomain')
  const context = (searchParams.get('context') || 'team') as 'team' | 'portal'
  const popup = searchParams.get('popup') === 'true'

  if (!subdomain) {
    return NextResponse.json({ error: 'subdomain parameter is required' }, { status: 400 })
  }

  // Validate subdomain format (alphanumeric and hyphens only)
  if (!/^[a-z0-9-]+$/.test(subdomain)) {
    return NextResponse.json({ error: 'Invalid subdomain format' }, { status: 400 })
  }

  // Validate context
  if (context !== 'team' && context !== 'portal') {
    return NextResponse.json({ error: 'Invalid context' }, { status: 400 })
  }

  // Validate provider
  const validProviders = ['google', 'github', 'microsoft']
  if (!validProviders.includes(provider)) {
    return NextResponse.json({ error: 'Invalid OAuth provider' }, { status: 400 })
  }

  // Fetch auth and portal configs using the service
  const [authResult, portalResult] = await Promise.all([
    organizationService.getPublicAuthConfig(subdomain),
    organizationService.getPublicPortalConfig(subdomain),
  ])

  if (!authResult.success && !portalResult.success) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  const authConfig = authResult.success ? authResult.value : { oauth: DEFAULT_AUTH_CONFIG.oauth }
  const portalConfig = portalResult.success
    ? portalResult.value
    : { oauth: DEFAULT_PORTAL_CONFIG.oauth }

  // Check if this OAuth provider is enabled for the organization
  if (!isProviderEnabled(authConfig, portalConfig, provider, context)) {
    return NextResponse.json(
      { error: 'This authentication method is not enabled for this organization' },
      { status: 403 }
    )
  }

  // Get auth secret for HMAC signing
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Generate nonce for replay protection
  const nonce = randomBytes(16).toString('hex')
  const timestamp = Date.now()

  // Create state payload and sign it (includes context for role assignment, provider, and popup mode)
  const statePayload = JSON.stringify({ subdomain, context, provider, popup, nonce, timestamp })
  const signature = signState(statePayload, secret)

  // Store signed state in cookie
  const oauthTarget = JSON.stringify({ payload: statePayload, signature })

  // Build the OAuth callback URL using the current origin
  const origin = request.nextUrl.origin
  const callbackURL = `${origin}/api/auth/oauth-callback`

  // Redirect to Better-Auth's OAuth endpoint
  const oauthUrl = new URL(`${origin}/api/auth/sign-in/social`)
  oauthUrl.searchParams.set('provider', provider)
  oauthUrl.searchParams.set('callbackURL', callbackURL)

  const response = NextResponse.redirect(oauthUrl)

  // Set the oauth_target cookie with signed state
  response.cookies.set('oauth_target', oauthTarget, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300, // 5 minutes
    path: '/',
  })

  return response
}
