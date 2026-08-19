/**
 * ClickUp OAuth utilities.
 */

const CLICKUP_API = 'https://api.clickup.com/api/v2'

/**
 * Generate the ClickUp OAuth authorization URL.
 */
export function getClickUpOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('ClickUp client ID not configured')
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
    throw new Error('ClickUp credentials not configured')
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
