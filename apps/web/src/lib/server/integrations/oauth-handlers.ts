/**
 * OAuth route handlers for integration connect/callback flows.
 *
 * This module is server-only and uses static imports from the integration registry.
 * Route files should dynamic-import from here to prevent @slack/web-api from
 * leaking into the client bundle via TanStack Router's routeTree.
 */

import type { PrincipalId, UserId } from '@quackback/ids'
import { getIntegration } from '.'
import { verifyOAuthState } from '@/lib/server/auth/oauth-state'
import { auth } from '@/lib/server/auth'
import { db, principal, eq } from '@/lib/server/db'
import {
  STATE_EXPIRY_MS,
  isSecureRequest,
  getStateCookieName,
  buildCallbackUri,
  getPublicOriginFromRequest,
  parseCookies,
  redirectResponse,
  clearStateCookies,
  createCookie,
  getStateCookieNameVariants,
  isValidTenantDomain,
} from './oauth'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'oauth' })

const FALLBACK_URL = 'https://quackback.io'

interface OAuthState {
  type: string
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
  /** Pre-auth fields collected before OAuth (e.g. Zendesk subdomain) */
  preAuthFields?: Record<string, string>
  /** 'new' = create a new integration row, 'reconnect' = update existing */
  intent?: 'new' | 'reconnect'
  /** Integration ID to reconnect (when intent === 'reconnect') */
  integrationId?: string
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

function buildTenantUrl(returnDomain: string, request: Request): string {
  try {
    const requestOrigin = getPublicOriginFromRequest(request)
    if (new URL(requestOrigin).host === returnDomain) {
      return requestOrigin
    }
  } catch {
    // Fall back to the historical HTTPS return-domain behavior below.
  }

  return `https://${returnDomain}`
}

function normalizePreAuthConfig(
  fields: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!fields) return undefined

  const { repoFullName, ...config } = fields
  if (repoFullName && !config.channelId) {
    config.channelId = repoFullName
  }

  return config
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

  const { returnDomain, principalId } = stateData
  const tenantUrl = buildTenantUrl(returnDomain, request)

  if (!isValidTenantDomain(returnDomain)) {
    return redirectResponse(errorUrl(FALLBACK_URL, 'invalid_tenant'))
  }

  if (providerError) {
    return redirectResponse(errorUrl(tenantUrl, `${integrationType}_denied`))
  }

  if (!code) {
    return redirectResponse(errorUrl(tenantUrl, 'invalid_request'))
  }

  const cookies = parseCookies(request.headers.get('cookie') || '')
  const matchedCookieName = getStateCookieNameVariants(integrationType).find(
    (name) => cookies[name] === state
  )
  if (!matchedCookieName) {
    return redirectResponse(errorUrl(tenantUrl, 'state_mismatch'))
  }

  // Verify the current session matches the member who initiated the flow
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return redirectResponse(errorUrl(tenantUrl, 'auth_required'))
    }
    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
    })
    if (!principalRecord || (principalRecord.id as PrincipalId) !== principalId) {
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
    const callbackUri = `${tenantUrl}/oauth/${integrationType}/callback`
    const exchangeResult = await definition.oauth.exchangeCode(
      code,
      callbackUri,
      stateData.preAuthFields,
      credentials
    )
    accessToken = exchangeResult.accessToken

    const { saveIntegration } = await import('./save')
    const saveParams: Parameters<typeof saveIntegration>[1] = {
      principalId,
      ...exchangeResult,
      ...(stateData.intent === 'new' ? { forceCreate: true } : {}),
      ...(stateData.intent === 'reconnect' && stateData.integrationId
        ? { integrationId: stateData.integrationId as import('@quackback/ids').IntegrationId }
        : {}),
    }
    // Pass pre-auth fields as initial config for new connections (e.g., repo full name)
    const preAuthConfig = normalizePreAuthConfig(stateData.preAuthFields)
    if (preAuthConfig && stateData.intent === 'new') {
      saveParams.config = { ...saveParams.config, ...preAuthConfig }
    }
    await saveIntegration(integrationType, saveParams)

    const successUrl = buildSettingsUrl(tenantUrl, settingsPath, integrationType, 'connected')
    return redirectResponse(successUrl, clearStateCookies(integrationType))
  } catch (err) {
    log.error({ err, integration_type: integrationType }, 'oauth exchange/save failed')

    // If we got a token but failed to save, attempt to revoke it
    if (accessToken && definition.onDisconnect) {
      try {
        await definition.onDisconnect({ accessToken } as Record<string, unknown>, {})
      } catch (revokeErr) {
        log.error(
          { err: revokeErr, integration_type: integrationType },
          'token revocation after save failure failed'
        )
      }
    }

    return redirectResponse(errorUrl(tenantUrl, 'exchange_failed'))
  }
}
