/**
 * Intercom OAuth utilities.
 */

const INTERCOM_API = 'https://api.intercom.io'

/**
 * Generate the Intercom OAuth authorization URL.
 */
export function getIntercomOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Intercom client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
  })

  return `https://app.intercom.com/oauth?${params}`
}

/**
 * Exchange an OAuth code for an access token.
 */
export async function exchangeIntercomCode(
  code: string,
  _redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Intercom credentials not configured')
  }

  const tokenResponse = await fetch('https://api.intercom.io/auth/eagle/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Intercom OAuth failed: ${error}`)
  }

  const data = (await tokenResponse.json()) as { token: string }

  // Get workspace info
  const meResponse = await fetch(`${INTERCOM_API}/me`, {
    headers: {
      Authorization: `Bearer ${data.token}`,
      Accept: 'application/json',
      'Intercom-Version': '2.11',
    },
  })

  let appId = 'unknown'
  let appName = 'Intercom'

  if (meResponse.ok) {
    const meData = (await meResponse.json()) as {
      app?: { id_code: string; name: string }
    }
    if (meData.app) {
      appId = meData.app.id_code
      appName = meData.app.name
    }
  }

  return {
    accessToken: data.token,
    config: { appId, workspaceName: appName },
  }
}
