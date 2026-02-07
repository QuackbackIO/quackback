/**
 * Intercom OAuth utilities.
 */

import { config } from '@/lib/server/config'

const INTERCOM_API = 'https://api.intercom.io'

/**
 * Generate the Intercom OAuth authorization URL.
 */
export function getIntercomOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.intercomClientId
  if (!clientId) {
    throw new Error('INTERCOM_CLIENT_ID environment variable not set')
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
  _redirectUri: string
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = config.intercomClientId
  const clientSecret = config.intercomClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('INTERCOM_CLIENT_ID and INTERCOM_CLIENT_SECRET must be set')
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
