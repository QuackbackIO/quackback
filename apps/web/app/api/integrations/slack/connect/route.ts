/**
 * Slack OAuth Connect Route
 *
 * Receives a pre-signed state and redirects to Slack.
 * The state is generated via a server action with the user's session,
 * then passed here as a query param.
 *
 * This route sets the state cookie for the callback.
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { getSlackOAuthUrl } from '@quackback/integrations'

/**
 * Build URL from request headers.
 */
function buildBaseUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host = request.headers.get('host')
  return `${proto}://${host}`
}

/**
 * Determine if request is secure.
 */
function isSecureRequest(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https'
}
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
): { memberId: string; nonce: string; timestamp: number } | null {
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

  // Verify the state signature
  const stateData = verifyState(state)
  if (!stateData) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
  }

  // Build redirect URI from request
  const baseUrl = buildBaseUrl(request)
  const redirectUri = `${baseUrl}/api/integrations/slack/callback`

  // Get Slack OAuth URL
  const slackUrl = getSlackOAuthUrl(state, redirectUri)

  // Set state cookie
  const isSecure = isSecureRequest(request)
  const cookieName = isSecure ? '__Secure-slack_oauth_state' : 'slack_oauth_state'
  const cookieStore = await cookies()
  cookieStore.set(cookieName, state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: STATE_EXPIRY_MS / 1000,
    path: '/',
  })

  return NextResponse.redirect(slackUrl)
}
