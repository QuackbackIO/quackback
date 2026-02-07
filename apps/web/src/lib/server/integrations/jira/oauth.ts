/**
 * Jira (Atlassian) OAuth 2.0 (3LO) utilities.
 */

import { config } from '@/lib/server/config'

/**
 * Generate the Atlassian OAuth authorization URL.
 */
export function getJiraOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.jiraClientId
  if (!clientId) {
    throw new Error('JIRA_CLIENT_ID environment variable not set')
  }

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: 'read:jira-work write:jira-work offline_access',
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  })

  return `https://auth.atlassian.com/authorize?${params}`
}

/**
 * Exchange an OAuth code for tokens and fetch accessible resources.
 */
export async function exchangeJiraCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
}> {
  const clientId = config.jiraClientId
  const clientSecret = config.jiraClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('JIRA_CLIENT_ID and JIRA_CLIENT_SECRET must be set')
  }

  // Exchange code for tokens
  const tokenResponse = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Jira OAuth failed: ${error}`)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  // Get accessible resources (cloudId + site name)
  const resourcesResponse = await fetch(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }
  )

  let cloudId = 'unknown'
  let siteName = 'Jira'
  let siteUrl = ''

  if (resourcesResponse.ok) {
    const resources = (await resourcesResponse.json()) as Array<{
      id: string
      name: string
      url: string
    }>

    if (resources.length > 0) {
      cloudId = resources[0].id
      siteName = resources[0].name
      siteUrl = resources[0].url
    }
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    config: { cloudId, siteUrl, workspaceName: siteName },
  }
}

/**
 * Refresh a Jira access token.
 */
export async function refreshJiraToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const clientId = config.jiraClientId
  const clientSecret = config.jiraClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('JIRA_CLIENT_ID and JIRA_CLIENT_SECRET must be set')
  }

  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`Jira token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}
