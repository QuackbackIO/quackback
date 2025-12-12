import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { signOAuthState } from '@/lib/auth/oauth-state'

/**
 * OAuth Initiation Route
 *
 * Initiates OAuth flow with GitHub or Google. All OAuth flows happen on the
 * main domain to use a single callback URL registered with providers.
 *
 * Query params:
 * - org: Organization slug (required)
 * - returnDomain: Domain to redirect to after auth (required)
 * - context: 'team' or 'portal' (default: 'portal')
 * - callbackUrl: Path to redirect to after login (default: '/')
 *
 * Flow:
 * 1. Validate org exists
 * 2. Build OAuth URL with state containing org + returnDomain
 * 3. Redirect to OAuth provider
 */

interface OAuthConfig {
  authUrl: string
  clientId: string
  scope: string
}

const OAUTH_CONFIGS: Record<string, OAuthConfig | undefined> = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    scope: 'read:user user:email',
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    scope: 'openid email profile',
  },
}

function buildCallbackUrl(): string {
  const domain = process.env.APP_DOMAIN
  if (!domain) throw new Error('APP_DOMAIN is required')
  const protocol = domain.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${domain}/api/auth/oauth-callback`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const searchParams = request.nextUrl.searchParams

  const orgSlug = searchParams.get('org')
  const returnDomain = searchParams.get('returnDomain')
  const context = searchParams.get('context') || 'portal'
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const popup = searchParams.get('popup') === 'true'

  // Validate required params
  if (!orgSlug || !returnDomain) {
    return NextResponse.json(
      { error: 'Missing required params: org, returnDomain' },
      { status: 400 }
    )
  }

  // Validate provider
  const config = OAUTH_CONFIGS[provider]
  if (!config) {
    return NextResponse.json({ error: 'Invalid OAuth provider' }, { status: 400 })
  }

  if (!config.clientId) {
    return NextResponse.json({ error: `${provider} OAuth is not configured` }, { status: 500 })
  }

  // Validate org exists
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, orgSlug),
    columns: { id: true },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  // Build state with org info (HMAC-signed to prevent tampering)
  const stateData = {
    org: orgSlug,
    returnDomain,
    context,
    callbackUrl,
    popup,
    ts: Date.now(), // Prevent replay attacks
  }
  const signedState = signOAuthState(stateData)

  // Build OAuth URL
  const oauthUrl = new URL(config.authUrl)
  oauthUrl.searchParams.set('client_id', config.clientId)
  oauthUrl.searchParams.set('redirect_uri', buildCallbackUrl())
  oauthUrl.searchParams.set('scope', config.scope)
  oauthUrl.searchParams.set('state', `${provider}:${signedState}`)

  // Provider-specific params
  if (provider === 'google') {
    oauthUrl.searchParams.set('response_type', 'code')
    oauthUrl.searchParams.set('access_type', 'offline')
    oauthUrl.searchParams.set('prompt', 'select_account')
  }

  return NextResponse.redirect(oauthUrl.toString())
}
