/**
 * Salesforce OAuth utilities.
 */

/**
 * Generate the Salesforce OAuth authorization URL.
 */
export function getSalesforceOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Salesforce client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: 'api refresh_token',
  })

  return `https://login.salesforce.com/services/oauth2/authorize?${params}`
}

/**
 * Exchange an OAuth code for access tokens.
 */
export async function exchangeSalesforceCode(
  code: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): Promise<{
  accessToken: string
  refreshToken?: string
  config?: Record<string, unknown>
}> {
  const clientId = credentials?.clientId
  const clientSecret = credentials?.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Salesforce credentials not configured')
  }

  const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Salesforce OAuth failed: ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    instance_url: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    config: {
      instanceUrl: data.instance_url,
      workspaceName: 'Salesforce',
    },
  }
}
