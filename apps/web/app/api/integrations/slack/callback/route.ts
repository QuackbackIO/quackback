/**
 * Slack OAuth Callback Route
 *
 * Handles the OAuth callback from Slack, validates state, exchanges code for token,
 * encrypts and stores the token.
 */
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { db, encryptToken, organizationIntegrations, organization, eq } from '@/lib/db'
import { exchangeSlackCode } from '@quackback/integrations'
import type { MemberId, OrgId } from '@quackback/ids'

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

function verifyState(
  state: string
):
  | { valid: true; data: { orgId: string; memberId: string; nonce: string; timestamp: number } }
  | { valid: false } {
  try {
    const [payloadB64, signature] = state.split('.')
    if (!payloadB64 || !signature) {
      return { valid: false }
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
      return { valid: false }
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false }
    }

    // Check timestamp hasn't expired
    if (Date.now() - data.timestamp > STATE_EXPIRY_MS) {
      return { valid: false }
    }

    return { valid: true, data }
  } catch {
    return { valid: false }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Get the org slug for redirect (we'll need to look it up)
  const cookieStore = await cookies()
  const storedState = cookieStore.get(STATE_COOKIE_NAME)?.value

  // Clear the state cookie
  cookieStore.delete(STATE_COOKIE_NAME)

  // Check for Slack error
  if (error) {
    console.error('[Slack OAuth] Error from Slack:', error)
    return redirectWithError('slack_denied', storedState)
  }

  if (!code || !state) {
    console.error('[Slack OAuth] Missing code or state')
    return redirectWithError('invalid_request', storedState)
  }

  // Verify state cookie matches URL state
  if (!storedState || state !== storedState) {
    console.error('[Slack OAuth] State mismatch')
    return redirectWithError('state_mismatch', storedState)
  }

  // Verify state signature and expiry
  const stateResult = verifyState(state)
  if (!stateResult.valid) {
    console.error('[Slack OAuth] Invalid state signature or expired')
    return redirectWithError('invalid_state', storedState)
  }

  const { orgId: rawOrgId, memberId: rawMemberId } = stateResult.data
  // IDs from state are already in TypeID format
  const orgId = rawOrgId as OrgId
  const memberId = rawMemberId as MemberId

  try {
    // Exchange code for token
    const appUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/integrations/slack/callback`
    const { accessToken, teamId, teamName } = await exchangeSlackCode(code, redirectUri)

    // Encrypt the token
    const encryptedToken = encryptToken(accessToken, orgId)

    // Upsert the integration
    await db
      .insert(organizationIntegrations)
      .values({
        organizationId: orgId,
        integrationType: 'slack',
        status: 'active',
        accessTokenEncrypted: encryptedToken,
        externalWorkspaceId: teamId,
        externalWorkspaceName: teamName,
        connectedByMemberId: memberId,
        connectedAt: new Date(),
        config: {},
      })
      .onConflictDoUpdate({
        target: [organizationIntegrations.organizationId, organizationIntegrations.integrationType],
        set: {
          status: 'active',
          accessTokenEncrypted: encryptedToken,
          externalWorkspaceId: teamId,
          externalWorkspaceName: teamName,
          connectedByMemberId: memberId,
          connectedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
          errorCount: 0,
          updatedAt: new Date(),
        },
      })

    // Get org slug for redirect
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, orgId),
    })

    if (!org) {
      return redirectWithError('org_not_found', storedState)
    }

    // Redirect to Slack detail page with success
    const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
    const isLocalhost = appDomain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    return NextResponse.redirect(
      `${protocol}://${org.slug}.${appDomain}/admin/settings/integrations/slack?slack=connected`
    )
  } catch (err) {
    console.error('[Slack OAuth] Exchange error:', err)
    return redirectWithError('exchange_failed', storedState)
  }
}

async function redirectWithError(error: string, storedState: string | undefined) {
  const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
  const isLocalhost = appDomain.includes('localhost')
  const protocol = isLocalhost ? 'http' : 'https'

  // Try to extract orgId from stored state to redirect to correct org
  if (storedState) {
    try {
      const [payloadB64] = storedState.split('.')
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        const org = await db.query.organization.findFirst({
          where: eq(organization.id, payload.orgId),
        })
        if (org) {
          return NextResponse.redirect(
            `${protocol}://${org.slug}.${appDomain}/admin/settings/integrations/slack?slack=error&reason=${error}`
          )
        }
      }
    } catch {
      // Fall through to default redirect
    }
  }

  // Fallback redirect to main domain
  return NextResponse.redirect(`${protocol}://${appDomain}?slack_error=${error}`)
}
