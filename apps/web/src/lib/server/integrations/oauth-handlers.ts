/**
 * OAuth route handlers for integration connect/callback flows.
 *
 * This module is server-only and uses static imports from the integration registry.
 * Route files should dynamic-import from here to prevent @slack/web-api from
 * leaking into the client bundle via TanStack Router's routeTree.
 */

import type { MemberId, UserId } from '@quackback/ids'
import { getIntegration } from '.'
import { verifyOAuthState } from '@/lib/server/auth/oauth-state'
import { auth } from '@/lib/server/auth'
import { db, member, eq } from '@/lib/server/db'
import {
  STATE_EXPIRY_MS,
  isSecureRequest,
  getStateCookieName,
  buildCallbackUri,
  parseCookies,
  redirectResponse,
  clearCookie,
  createCookie,
  isValidTenantDomain,
} from './oauth'

const FALLBACK_URL = 'https://quackback.io'

interface OAuthState {
  type: string
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
  /** Pre-auth fields collected before OAuth (e.g. Zendesk subdomain) */
  preAuthFields?: Record<string, string>
}

function buildSettingsUrl(
  baseUrl: string,
  settingsPath: string,
  integration: string,
  status: 'error' | 'connected',
  reason?: string
): string {
  const params = new URLSearchParams({ [integration]: status, ...(reason && { reason }) })
  return `${baseUrl}${settingsPath}?${params}`
}

/**
 * Handle the OAuth connect redirect (GET /oauth/:integration/connect)
 */
export async function handleOAuthConnect(
  request: Request,
  integrationType: string
): Promise<Response> {
  const definition = getIntegration(integrationType)

  if (!definition?.oauth) {
    return Response.json({ error: 'Unknown integration' }, { status: 404 })
  }

  const url = new URL(request.url)
  const state = url.searchParams.get('state')

  if (!state) {
    return Response.json({ error: 'state is required' }, { status: 400 })
  }

  const stateData = verifyOAuthState<OAuthState>(state)
  if (!stateData || stateData.type !== definition.oauth.stateType) {
    return Response.json({ error: 'Invalid state' }, { status: 400 })
  }

  if (Date.now() - stateData.ts > STATE_EXPIRY_MS) {
    return Response.json({ error: 'State expired' }, { status: 400 })
  }

  // Fetch platform credentials from DB
  let credentials: Record<string, string> | undefined
  if (definition.platformCredentials.length > 0) {
    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const creds = await getPlatformCredentials(integrationType)
    if (!creds) {
      return Response.json(
        { error: `Platform credentials not configured for ${integrationType}` },
        { status: 400 }
      )
    }
    credentials = creds
  }

  const callbackUri = buildCallbackUri(integrationType, request)
  const authUrl = definition.oauth.buildAuthUrl(
    state,
    callbackUri,
    stateData.preAuthFields,
    credentials
  )
  const isSecure = isSecureRequest(request)
  const cookieName = getStateCookieName(integrationType, request)
  const maxAgeSeconds = STATE_EXPIRY_MS / 1000

  return redirectResponse(authUrl, [createCookie(cookieName, state, isSecure, maxAgeSeconds)])
}

/**
 * Handle the OAuth callback (GET /oauth/:integration/callback)
 */
export async function handleOAuthCallback(
  request: Request,
  integrationType: string
): Promise<Response> {
  const definition = getIntegration(integrationType)

  if (!definition?.oauth) {
    return Response.json({ error: 'Unknown integration' }, { status: 404 })
  }

  const settingsPath = definition.catalog.settingsPath
  const errorUrl = (base: string, reason: string) =>
    buildSettingsUrl(base, settingsPath, integrationType, 'error', reason)

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = definition.oauth.errorParam ?? 'error'
  const providerError = url.searchParams.get(errorParam)

  const stateData = verifyOAuthState<OAuthState>(state || '')
  if (!stateData || stateData.type !== definition.oauth.stateType) {
    return redirectResponse(errorUrl(FALLBACK_URL, 'invalid_state'))
  }

  if (Date.now() - stateData.ts > STATE_EXPIRY_MS) {
    return redirectResponse(errorUrl(FALLBACK_URL, 'state_expired'))
  }

  const { returnDomain, memberId } = stateData
  const tenantUrl = `https://${returnDomain}`

  if (!isValidTenantDomain(returnDomain)) {
    return redirectResponse(errorUrl(FALLBACK_URL, 'invalid_tenant'))
  }

  if (providerError) {
    return redirectResponse(errorUrl(tenantUrl, `${integrationType}_denied`))
  }

  if (!code) {
    return redirectResponse(errorUrl(tenantUrl, 'invalid_request'))
  }

  const cookieName = getStateCookieName(integrationType, request)
  const cookies = parseCookies(request.headers.get('cookie') || '')
  if (cookies[cookieName] !== state) {
    return redirectResponse(errorUrl(tenantUrl, 'state_mismatch'))
  }

  // Verify the current session matches the member who initiated the flow
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return redirectResponse(errorUrl(tenantUrl, 'auth_required'))
    }
    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord || (memberRecord.id as MemberId) !== memberId) {
      return redirectResponse(errorUrl(tenantUrl, 'session_mismatch'))
    }
  } catch {
    return redirectResponse(errorUrl(tenantUrl, 'auth_required'))
  }

  // Fetch platform credentials from DB for exchange
  let credentials: Record<string, string> | undefined
  if (definition.platformCredentials.length > 0) {
    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const creds = await getPlatformCredentials(integrationType)
    if (!creds) {
      return redirectResponse(errorUrl(tenantUrl, 'credentials_not_configured'))
    }
    credentials = creds
  }

  let accessToken: string | undefined
  try {
    const callbackUri = buildCallbackUri(integrationType, request)
    const exchangeResult = await definition.oauth.exchangeCode(
      code,
      callbackUri,
      stateData.preAuthFields,
      credentials
    )
    accessToken = exchangeResult.accessToken

    const { saveIntegration } = await import('./save')
    await saveIntegration(integrationType, { memberId, ...exchangeResult })

    const successUrl = buildSettingsUrl(tenantUrl, settingsPath, integrationType, 'connected')
    return redirectResponse(successUrl, [clearCookie(cookieName, isSecureRequest(request))])
  } catch (err) {
    console.error(`[${integrationType}] Exchange/save error:`, err)

    // If we got a token but failed to save, attempt to revoke it
    if (accessToken && definition.onDisconnect) {
      try {
        await definition.onDisconnect({ accessToken } as Record<string, unknown>, {})
      } catch (revokeErr) {
        console.error(
          `[${integrationType}] Token revocation after save failure also failed:`,
          revokeErr
        )
      }
    }

    return redirectResponse(errorUrl(tenantUrl, 'exchange_failed'))
  }
}
