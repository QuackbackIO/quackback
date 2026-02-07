/**
 * Zendesk OAuth utilities.
 * Zendesk OAuth URLs are subdomain-specific: https://{subdomain}.zendesk.com/oauth/...
 * The subdomain is collected via preAuthFields before the OAuth flow starts.
 */

/**
 * Generate the Zendesk OAuth authorization URL.
 */
export function getZendeskOAuthUrl(
  state: string,
  redirectUri: string,
  fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Zendesk client ID not configured')
  }

  const subdomain = fields?.subdomain
  if (!subdomain) {
    throw new Error('Zendesk subdomain is required')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'read write',
  })

  return `https://${subdomain}.zendesk.com/oauth/authorizations/new?${params}`
}

/**
 * Exchange an OAuth code for an access token.
 */
export async function exchangeZendeskCode(
  code: string,
  redirectUri: string,
  fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Zendesk credentials not configured')
  }

  const subdomain = fields?.subdomain
  if (!subdomain) {
    throw new Error('Zendesk subdomain is required')
  }

  const tokenResponse = await fetch(`https://${subdomain}.zendesk.com/oauth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      scope: 'read write',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Zendesk OAuth failed: ${error}`)
  }

  const data = (await tokenResponse.json()) as {
    access_token: string
    token_type: string
  }

  // Verify the token and get account info
  const userResponse = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })

  let accountName = `${subdomain}.zendesk.com`

  if (userResponse.ok) {
    const userData = (await userResponse.json()) as {
      user?: { name: string }
    }
    if (userData.user?.name) {
      accountName = userData.user.name
    }
  }

  return {
    accessToken: data.access_token,
    config: { subdomain, workspaceName: accountName },
  }
}

/**
 * Revoke a Zendesk OAuth token.
 */
export async function revokeZendeskToken(accessToken: string, subdomain: string): Promise<void> {
  try {
    if (!subdomain || subdomain === 'unknown') {
      console.log('[Zendesk] No subdomain available, skipping token revocation')
      return
    }

    await fetch(`https://${subdomain}.zendesk.com/api/v2/oauth/tokens/current.json`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    console.log('[Zendesk] Token revoked successfully')
  } catch (error) {
    console.error('[Zendesk] Failed to revoke token:', error)
  }
}
