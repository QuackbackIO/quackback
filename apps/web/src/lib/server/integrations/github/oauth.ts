/**
 * GitHub OAuth utilities.
 */

const GITHUB_API = 'https://api.github.com'

/**
 * Generate the GitHub OAuth authorization URL.
 */
export function getGitHubOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('GitHub client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'repo',
  })

  return `https://github.com/login/oauth/authorize?${params}`
}

/**
 * Exchange an OAuth code for an access token.
 */
export async function exchangeGitHubCode(
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
    throw new Error('GitHub credentials not configured')
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'quackback',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`GitHub OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (tokens.error || !tokens.access_token) {
    throw new Error(
      `GitHub OAuth failed: ${tokens.error_description || tokens.error || 'No access token returned'}`
    )
  }

  // Get authenticated user info
  const userResponse = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  let username = 'unknown'
  let displayName = 'GitHub'

  if (userResponse.ok) {
    const userData = (await userResponse.json()) as {
      login?: string
      name?: string
    }
    if (userData.login) {
      username = userData.login
      displayName = userData.name || userData.login
    }
  }

  return {
    accessToken: tokens.access_token,
    config: { username, workspaceName: displayName },
  }
}

/**
 * Revoke a GitHub OAuth token.
 */
export async function revokeGitHubToken(
  accessToken: string,
  credentials?: Record<string, string>
): Promise<void> {
  try {
    const clientId = credentials?.clientId
    const clientSecret = credentials?.clientSecret

    if (!clientId || !clientSecret) return

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    await fetch(`${GITHUB_API}/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'quackback',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: accessToken }),
    })
    console.log('[GitHub] Token revoked successfully')
  } catch (error) {
    console.error('[GitHub] Failed to revoke token:', error)
  }
}
