/**
 * Slack channel listing and membership.
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

/**
 * Join a channel. Only works for public channels.
 * For private channels, the bot must be manually invited.
 * Returns true if the bot is now in the channel (joined or already a member).
 */
export async function joinSlackChannel(accessToken: string, channelId: string): Promise<boolean> {
  const client = new WebClient(accessToken)
  try {
    await client.conversations.join({ channel: channelId })
    return true
  } catch (error: any) {
    if (error?.data?.error === 'method_not_supported_for_channel_type') {
      // Private channel -- bot must be invited manually
      console.warn(`[Slack] Cannot join private channel ${channelId} -- bot must be invited`)
      return false
    }
    if (error?.data?.error === 'already_in_channel') {
      return true
    }
    throw error
  }
}
