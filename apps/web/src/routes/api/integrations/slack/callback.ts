import { createFileRoute } from '@tanstack/react-router'
import { createHmac, timingSafeEqual } from 'crypto'
import type { MemberId } from '@quackback/ids'

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

/**
 * Get the state cookie name based on whether request is secure.
 */
function getStateCookieName(request: Request): string {
  return isSecureRequest(request) ? '__Secure-slack_oauth_state' : 'slack_oauth_state'
}

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
  | { valid: true; data: { memberId: string; nonce: string; timestamp: number } }
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

function redirectWithError(baseUrl: string, error: string) {
  return Response.redirect(
    `${baseUrl}/admin/settings/integrations/slack?slack=error&reason=${error}`,
    302
  )
}

export const Route = createFileRoute('/api/integrations/slack/callback')({
  server: {
    handlers: {
      /**
       * GET /api/integrations/slack/callback
       * Handles Slack OAuth callback
       */
      GET: async ({ request }) => {
        const { db, encryptToken, integrations } = await import('@/lib/db')
        const { exchangeSlackCode } = await import('@quackback/integrations')

        console.log(`[slack] OAuth callback received`)

        const { searchParams } = new URL(request.url)
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        const error = searchParams.get('error')

        const baseUrl = buildBaseUrl(request)
        const cookieName = getStateCookieName(request)

        // Extract state cookie from request
        const cookieHeader = request.headers.get('cookie') || ''
        const cookies = Object.fromEntries(
          cookieHeader.split('; ').map((c) => {
            const [key, ...rest] = c.split('=')
            return [key, rest.join('=')]
          })
        )
        const storedState = cookies[cookieName]

        // Check for Slack error
        if (error) {
          console.error(`[slack] ❌ OAuth error from Slack: ${error}`)
          return redirectWithError(baseUrl, 'slack_denied')
        }

        if (!code || !state) {
          console.error(`[slack] ❌ Missing code or state`)
          return redirectWithError(baseUrl, 'invalid_request')
        }

        // Verify state cookie matches URL state
        if (!storedState || state !== storedState) {
          console.error(`[slack] ❌ State mismatch`)
          return redirectWithError(baseUrl, 'state_mismatch')
        }

        // Verify state signature and expiry
        const stateResult = verifyState(state)
        if (!stateResult.valid) {
          console.error(`[slack] ❌ Invalid state signature or expired`)
          return redirectWithError(baseUrl, 'invalid_state')
        }

        const { memberId: rawMemberId } = stateResult.data
        const memberId = rawMemberId as MemberId

        try {
          // Exchange code for token
          console.log(`[slack] 🔄 Exchanging code for token`)
          const redirectUri = `${baseUrl}/api/integrations/slack/callback`
          const { accessToken, teamId, teamName } = await exchangeSlackCode(code, redirectUri)
          console.log(`[slack] ✅ Token exchange complete: workspace=${teamName}`)

          // Encrypt the token (pass empty string for single workspace)
          const encryptedToken = encryptToken(accessToken, '')

          // Upsert the integration
          await db
            .insert(integrations)
            .values({
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
              target: [integrations.integrationType],
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

          // Redirect to Slack detail page with success
          const successResponse = Response.redirect(
            `${baseUrl}/admin/settings/integrations/slack?slack=connected`,
            302
          )

          // Clear state cookie by setting it with expired date
          const isSecure = isSecureRequest(request)
          successResponse.headers.append(
            'Set-Cookie',
            `${cookieName}=; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0; Path=/`
          )

          console.log(`[slack] ✅ Integration saved`)
          return successResponse
        } catch (err) {
          console.error(`[slack] ❌ Exchange error:`, err)
          return redirectWithError(baseUrl, 'exchange_failed')
        }
      },
    },
  },
})
