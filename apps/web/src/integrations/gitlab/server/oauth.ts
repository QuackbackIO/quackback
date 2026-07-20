/**
 * GitLab OAuth utilities.
 */

/**
 * Generate the GitLab OAuth authorization URL.
 */
export function getGitLabOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('GitLab client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'api',
  })

  return `https://gitlab.com/oauth/authorize?${params}`
}

/**
 * Exchange an OAuth code for access tokens.
 */
export async function exchangeGitLabCode(
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
    throw new Error('GitLab credentials not configured')
  }

  const response = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitLab OAuth failed: ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // Fetch user info for workspace name
  const userResponse = await fetch('https://gitlab.com/api/v4/user', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })

  const user = userResponse.ok
    ? ((await userResponse.json()) as { name: string; username: string })
    : null

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    config: {
      workspaceName: user?.name || user?.username || 'GitLab',
    },
  }
}
