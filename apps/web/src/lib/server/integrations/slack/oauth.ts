/**
 * Slack OAuth utilities.
 * Handles OAuth flow for connecting Slack workspaces.
 */

import { WebClient } from '@slack/web-api'

const SLACK_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:join',
  'chat:write',
  'team:read',
].join(',')

/**
 * Generate the Slack OAuth authorization URL.
 */
export function getSlackOAuthUrl(
  state: string,
  redirectUri: string,
  _fields?: Record<string, string>,
  credentials?: Record<string, string>
): string {
  const clientId = credentials?.clientId
  if (!clientId) {
    throw new Error('Slack client ID not configured')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES,
    redirect_uri: redirectUri,
    state,
  })

  return `https://slack.com/oauth/v2/authorize?${params}`
}

/**
 * Revoke a Slack OAuth token.
 * Best-effort: logs but does not throw on failure.
 */
export async function revokeSlackToken(accessToken: string): Promise<void> {
  try {
    const client = new WebClient(accessToken)
    await client.auth.revoke()
    console.log('[Slack] Token revoked successfully')
  } catch (error) {
    console.error('[Slack] Failed to revoke token:', error)
  }
}

/**
 * Exchange an OAuth code for access tokens.
 * Returns the canonical shape expected by IntegrationOAuthConfig.exchangeCode.
 */
export async function exchangeSlackCode(
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
    throw new Error('Slack credentials not configured')
  }

  const client = new WebClient()
  const response = await client.oauth.v2.access({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  if (!response.ok) {
    throw new Error(`Slack OAuth failed: ${response.error}`)
  }

  return {
    accessToken: response.access_token!,
    config: { workspaceId: response.team!.id!, workspaceName: response.team!.name! },
  }
}
