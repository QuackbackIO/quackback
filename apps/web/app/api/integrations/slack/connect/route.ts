/**
 * Slack OAuth Connect Route
 *
 * Receives a pre-signed state from the tenant subdomain and redirects to Slack.
 * The state is generated on the tenant subdomain (where the user has a session)
 * via a server action, then passed here as a query param.
 *
 * This route runs on the main domain and sets the state cookie for the callback.
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { getSlackOAuthUrl } from '@quackback/integrations'

// Cookie name - use __Secure- prefix for HTTPS
const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:3000'
const IS_SECURE = !APP_DOMAIN.includes('localhost')
const STATE_COOKIE_NAME = IS_SECURE ? '__Secure-slack_oauth_state' : 'slack_oauth_state'
const STATE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

function getHmacSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET not set')
  }
  return secret
}

/**
 * Verify the HMAC signature and expiry of the state.
 * Returns the parsed data if valid, null otherwise.
 */
function verifyState(
  state: string
): { orgId: string; memberId: string; nonce: string; timestamp: number } | null {
  try {
    const [payloadB64, signature] = state.split('.')
    if (!payloadB64 || !signature) {
      return null
    }

    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const data = JSON.parse(payload)

    // Verify HMAC signature
    const hmac = createHmac('sha256', getHmacSecret())
    hmac.update(payload)
    const expectedSig = hmac.digest('base64url')

    const sigBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expectedSig, 'base64url')

    if (sigBuffer.length !== expectedBuffer.length) {
      return null
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null
    }

    // Check timestamp hasn't expired
    if (Date.now() - data.timestamp > STATE_EXPIRY_MS) {
      return null
    }

    return data
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const state = searchParams.get('state')

  if (!state) {
    return NextResponse.json({ error: 'state is required' }, { status: 400 })
  }

  // Verify the state signature (already signed on tenant subdomain with user's session)
  const stateData = verifyState(state)
  if (!stateData) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
  }

  // Build redirect URI
  const appUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
  const redirectUri = `${appUrl}/api/integrations/slack/callback`

  // Get Slack OAuth URL
  const slackUrl = getSlackOAuthUrl(state, redirectUri)

  // Set state cookie (OAuth flow runs entirely on main domain)
  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: IS_SECURE,
    sameSite: 'lax',
    maxAge: STATE_EXPIRY_MS / 1000,
    path: '/',
  })

  return NextResponse.redirect(slackUrl)
}
