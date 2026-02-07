/**
 * Asana OAuth utilities.
 *
 * Asana uses short-lived access tokens (~1hr) with refresh tokens.
 * See: https://developers.asana.com/docs/oauth
 */

const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token'
const ASANA_API = 'https://app.asana.com/api/1.0'

/**
 * Generate the Asana OAuth authorization URL.
 */
export function getAsanaOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Asana client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  })

  return `https://app.asana.com/-/oauth_authorize?${params}`
}

/**
 * Exchange an OAuth code for access and refresh tokens.
 */
export async function exchangeAsanaCode(
  code: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Asana credentials not configured')
  }

  const tokenResponse = await fetch(ASANA_TOKEN_URL, {
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
    throw new Error(`Asana OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // Get user/workspace info
  const userResponse = await fetch(`${ASANA_API}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  let workspaceId = 'unknown'
  let workspaceName = 'Asana'

  if (userResponse.ok) {
    const userData = (await userResponse.json()) as {
      data?: {
        workspaces?: Array<{ gid: string; name: string }>
      }
    }
    const firstWorkspace = userData.data?.workspaces?.[0]
    if (firstWorkspace) {
      workspaceId = firstWorkspace.gid
      workspaceName = firstWorkspace.name
    }
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    config: { workspaceId, workspaceName },
  }
}

/**
 * Refresh an Asana access token using a refresh token.
 */
export async function refreshAsanaToken(
  refreshToken: string,
  credentials?: Record<string, string>
): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Asana credentials not configured')
  }

  const response = await fetch(ASANA_TOKEN_URL, {
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
    const error = await response.text()
    throw new Error(`Asana token refresh failed: ${error}`)
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
 * Revoke an Asana OAuth token via POST /oauth_revoke.
 */
export async function revokeAsanaToken(
  refreshToken: string,
  credentials?: Record<string, string>
): Promise<void> {
  try {
    const clientId = credentials?.clientId
    const clientSecret = credentials?.clientSecret

    if (!clientId || !clientSecret) return

    await fetch('https://app.asana.com/-/oauth_revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
      }),
    })
    console.log('[Asana] Token revoked successfully')
  } catch (error) {
    console.error('[Asana] Failed to revoke token:', error)
  }
}
