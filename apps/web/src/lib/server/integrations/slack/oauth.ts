/**
 * Slack OAuth utilities.
 * Handles OAuth flow for connecting Slack workspaces.
 */

import { WebClient } from '@slack/web-api'
import { config } from '@/lib/server/config'

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
export function getSlackOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.slackClientId
  if (!clientId) {
    throw new Error('SLACK_CLIENT_ID environment variable not set')
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
  redirectUri: string
): Promise<{
  accessToken: string
  externalWorkspaceId: string
  externalWorkspaceName: string
}> {
  const clientId = config.slackClientId
  const clientSecret = config.slackClientSecret

  if (!clientId || !clientSecret) {
    throw new Error('SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables must be set')
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
    externalWorkspaceId: response.team!.id!,
    externalWorkspaceName: response.team!.name!,
  }
}
