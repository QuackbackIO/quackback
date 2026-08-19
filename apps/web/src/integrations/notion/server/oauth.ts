/**
 * Notion OAuth utilities.
 * Handles OAuth2 flow for connecting a Notion workspace.
 */

const NOTION_API = 'https://api.notion.com/v1'

/**
 * Generate the Notion OAuth authorization URL.
 */
export function getNotionOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Notion client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    owner: 'user',
  })

  return `https://api.notion.com/v1/oauth/authorize?${params}`
}

/**
 * Exchange an OAuth code for access tokens and workspace info.
 */
export async function exchangeNotionCode(
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
    throw new Error('Notion credentials not configured')
  }

  const response = await fetch(`${NOTION_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Notion OAuth failed: ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    workspace_id: string
    workspace_name: string
    workspace_icon?: string
  }

  return {
    accessToken: data.access_token,
    config: {
      workspaceId: data.workspace_id,
      workspaceName: data.workspace_name || 'Notion',
    },
  }
}
