/**
 * Monday.com OAuth utilities.
 */

/**
 * Generate the Monday.com OAuth authorization URL.
 */
export function getMondayOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Monday.com client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })

  return `https://auth.monday.com/oauth2/authorize?${params}`
}

/**
 * Exchange an OAuth code for access tokens.
 */
export async function exchangeMondayCode(
  code: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Monday.com credentials not configured')
  }

  const response = await fetch('https://auth.monday.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Monday.com OAuth failed: ${error}`)
  }

  const data = (await response.json()) as { access_token: string }

  // Fetch account info
  const meResponse = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: data.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ me { account { name } } }' }),
  })

  const meData = meResponse.ok
    ? ((await meResponse.json()) as { data?: { me?: { account?: { name?: string } } } })
    : null

  return {
    accessToken: data.access_token,
    config: {
      workspaceName: meData?.data?.me?.account?.name || 'Monday.com',
    },
  }
}
