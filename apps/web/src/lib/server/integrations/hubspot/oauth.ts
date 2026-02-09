/**
 * HubSpot OAuth utilities.
 */

const HUBSPOT_API = 'https://api.hubapi.com'

const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
].join(' ')

/**
 * Generate the HubSpot OAuth authorization URL.
 */
export function getHubSpotOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('HubSpot client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: HUBSPOT_SCOPES,
    redirect_uri: redirectUri,
    state,
  })

  return `https://app.hubspot.com/oauth/authorize?${params}`
}

/**
 * Exchange an OAuth code for tokens.
 */
export async function exchangeHubSpotCode(
  code: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('HubSpot credentials not configured')
  }

  const tokenResponse = await fetch(`${HUBSPOT_API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`HubSpot OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // Get account info
  const accountResponse = await fetch(
    `${HUBSPOT_API}/oauth/v1/access-tokens/${tokens.access_token}`
  )

  let portalId = 'unknown'
  let hubDomain = 'HubSpot'

  if (accountResponse.ok) {
    const accountData = (await accountResponse.json()) as {
      hub_id?: number
      hub_domain?: string
    }
    if (accountData.hub_id) {
      portalId = String(accountData.hub_id)
    }
    if (accountData.hub_domain) {
      hubDomain = accountData.hub_domain
    }
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    config: { portalId, workspaceName: hubDomain },
  }
}

/**
 * Refresh a HubSpot access token.
 */
export async function refreshHubSpotToken(
  refreshToken: string,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('HubSpot credentials not configured')
  }

  const response = await fetch(`${HUBSPOT_API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`HubSpot token refresh failed: ${response.status}`)
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

/**
 * Revoke a HubSpot refresh token.
 */
export async function revokeHubSpotToken(
  refreshToken: string,
  credentials?: Record<string, string>
): Promise<void> {
  try {
    const clientId = credentials?.clientId
    if (!clientId) return

    await fetch(`${HUBSPOT_API}/oauth/v1/refresh-tokens/${refreshToken}`, {
      method: 'DELETE',
    })
    console.log('[HubSpot] Token revoked successfully')
  } catch (error) {
    console.error('[HubSpot] Failed to revoke token:', error)
  }
}
