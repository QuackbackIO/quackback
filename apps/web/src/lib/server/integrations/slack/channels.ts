/**
 * Slack channel listing.
 */

import { WebClient } from '@slack/web-api'

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
