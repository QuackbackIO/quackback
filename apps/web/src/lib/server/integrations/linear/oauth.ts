/**
 * Linear OAuth utilities.
 */

import { config } from '@/lib/server/config'

const LINEAR_API = 'https://api.linear.app'

/**
 * Generate the Linear OAuth authorization URL.
 */
export function getLinearOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.linearClientId
  if (!clientId) {
    throw new Error('LINEAR_CLIENT_ID environment variable not set')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'read,write,issues:create',
    prompt: 'consent',
  })

  return `https://linear.app/oauth/authorize?${params}`
}

/**
 * Exchange an OAuth code for an access token.
 */
export async function exchangeLinearCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
}> {
  const clientId = config.linearClientId
  const clientSecret = config.linearClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set')
  }

  const tokenResponse = await fetch(`${LINEAR_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Linear OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  // Get organization info via GraphQL
  const orgResponse = await fetch(`${LINEAR_API}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ organization { id name } }' }),
  })

  let orgId = 'unknown'
  let orgName = 'Linear'

  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as {
      data?: { organization?: { id: string; name: string } }
    }
    if (orgData.data?.organization) {
      orgId = orgData.data.organization.id
      orgName = orgData.data.organization.name
    }
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    config: { orgId, workspaceName: orgName },
  }
}

/**
 * Refresh a Linear access token.
 */
export async function refreshLinearToken(refreshToken: string): Promise<{
  accessToken: string
  expiresIn: number
}> {
  const clientId = config.linearClientId
  const clientSecret = config.linearClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set')
  }

  const response = await fetch(`${LINEAR_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`Linear token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Revoke a Linear OAuth token.
 */
export async function revokeLinearToken(accessToken: string): Promise<void> {
  try {
    const clientId = config.linearClientId
    const clientSecret = config.linearClientSecret

    if (!clientId || !clientSecret) return

    await fetch(`${LINEAR_API}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: accessToken,
      }),
    })
    console.log('[Linear] Token revoked successfully')
  } catch (error) {
    console.error('[Linear] Failed to revoke token:', error)
  }
}
