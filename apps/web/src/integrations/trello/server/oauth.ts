/**
 * Trello OAuth utilities.
 * Uses Trello's OAuth 1.0a-style authorization via API key + token.
 * Trello uses a simplified auth flow where users authorize via a URL and get a token.
 */

const TRELLO_API = 'https://api.trello.com/1'

/**
 * Generate the Trello authorization URL.
 * Trello uses API key based auth with a token redirect.
 */
export function getTrelloOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const apiKey = credentials?.clientId
  if (!apiKey) {
    throw new Error('Trello API key not configured')
  }

  const params = new URLSearchParams({
    key: apiKey,
    return_url: `${redirectUri}?state=${state}`,
    callback_method: 'fragment',
    scope: 'read,write',
    expiration: 'never',
    name: 'Quackback',
    response_type: 'token',
  })

  return `https://trello.com/1/authorize?${params}`
}

/**
 * Exchange the token from Trello authorization.
 * Trello returns the token directly in the redirect URL fragment.
 */
export async function exchangeTrelloCode(
  code: string,
  _redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const apiKey = credentials?.clientId

  if (!apiKey) {
    throw new Error('Trello API key not configured')
  }

  // Verify the token works by fetching member info
  const response = await fetch(
    `${TRELLO_API}/members/me?key=${apiKey}&token=${code}&fields=fullName,username`
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Trello authorization failed: ${error}`)
  }

  const member = (await response.json()) as { fullName: string; username: string }

  return {
    accessToken: code,
    config: {
      workspaceName: member.fullName || member.username,
      apiKey,
    },
  }
}
