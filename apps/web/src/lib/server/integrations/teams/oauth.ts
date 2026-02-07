/**
 * Microsoft Teams OAuth utilities.
 * Uses Azure AD OAuth2 with Microsoft Graph API.
 */

import { config } from '@/lib/server/config'

const GRAPH_API = 'https://graph.microsoft.com/v1.0'

const TEAMS_SCOPES = [
  'ChannelMessage.Send',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'offline_access',
].join(' ')

/**
 * Generate the Microsoft Teams OAuth authorization URL.
 */
export function getTeamsOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.teamsClientId
  if (!clientId) {
    throw new Error('TEAMS_CLIENT_ID environment variable not set')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: TEAMS_SCOPES,
    state,
    response_mode: 'query',
  })

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
}

/**
 * Exchange an OAuth code for tokens.
 */
export async function exchangeTeamsCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
}> {
  const clientId = config.teamsClientId
  const clientSecret = config.teamsClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('TEAMS_CLIENT_ID and TEAMS_CLIENT_SECRET must be set')
  }

  const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: TEAMS_SCOPES,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Teams OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  // Get organization info
  const orgResponse = await fetch(`${GRAPH_API}/organization`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  let orgName = 'Microsoft Teams'
  let orgId = 'unknown'

  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as {
      value: Array<{ id: string; displayName: string }>
    }
    if (orgData.value?.[0]) {
      orgId = orgData.value[0].id
      orgName = orgData.value[0].displayName
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
 * Refresh a Teams access token.
 */
export async function refreshTeamsToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const clientId = config.teamsClientId
  const clientSecret = config.teamsClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('TEAMS_CLIENT_ID and TEAMS_CLIENT_SECRET must be set')
  }

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: TEAMS_SCOPES,
    }),
  })

  if (!response.ok) {
    throw new Error(`Teams token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}
