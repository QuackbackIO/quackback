/**
 * ClickUp OAuth utilities.
 */

import { config } from '@/lib/server/config'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

/**
 * Generate the ClickUp OAuth authorization URL.
 */
export function getClickUpOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.clickupClientId
  if (!clientId) {
    throw new Error('CLICKUP_CLIENT_ID environment variable not set')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })

  return `https://app.clickup.com/api?${params}`
}

/**
 * Exchange an OAuth code for an access token.
 *
 * The returned access_token does not expire.
 */
export async function exchangeClickUpCode(
  code: string,
  _redirectUri: string
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = config.clickupClientId
  const clientSecret = config.clickupClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('CLICKUP_CLIENT_ID and CLICKUP_CLIENT_SECRET must be set')
  }

  const tokenResponse = await fetch(`${CLICKUP_API}/oauth/token`, {
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
    throw new Error(`ClickUp OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as { access_token: string }

  // Get team (workspace) info
  const teamResponse = await fetch(`${CLICKUP_API}/team`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  let teamId = 'unknown'
  let teamName = 'ClickUp'

  if (teamResponse.ok) {
    const teamData = (await teamResponse.json()) as {
      teams?: Array<{ id: string; name: string }>
    }
    if (teamData.teams?.[0]) {
      teamId = teamData.teams[0].id
      teamName = teamData.teams[0].name
    }
  }

  return {
    accessToken: tokens.access_token,
    config: { teamId, workspaceName: teamName },
  }
}
