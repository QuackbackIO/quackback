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
export function getSlackOAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env.SLACK_CLIENT_ID
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
 * Exchange an OAuth code for access tokens.
 */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  teamId: string
  teamName: string
}> {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET

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
    teamId: response.team!.id!,
    teamName: response.team!.name!,
  }
}

/**
 * List channels accessible to the bot.
 */
export async function listSlackChannels(
  accessToken: string
): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
  const client = new WebClient(accessToken)

  const result = await client.conversations.list({
    types: 'public_channel,private_channel',
    exclude_archived: true,
    limit: 200,
  })

  if (!result.ok) {
    throw new Error(`Failed to list channels: ${result.error}`)
  }

  return (result.channels || []).map(
    (channel: { id?: string; name?: string; is_private?: boolean }) => ({
      id: channel.id!,
      name: channel.name!,
      isPrivate: channel.is_private || false,
    })
  )
}
