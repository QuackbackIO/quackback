/**
 * Slack channel listing and membership.
 */

import { WebClient } from '@slack/web-api'

/**
 * List all channels accessible to the bot.
 * Uses cursor-based pagination to fetch every channel, filters out
 * Slack Connect / externally shared channels, and sorts alphabetically.
 */
export async function listSlackChannels(
  accessToken: string
): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
  const client = new WebClient(accessToken)
  const channels: Array<{ id: string; name: string; isPrivate: boolean }> = []
  let cursor: string | undefined

  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    })

    if (!result.ok) {
      throw new Error(`Failed to list channels: ${result.error}`)
    }

    for (const ch of result.channels || []) {
      // Skip Slack Connect (externally shared) channels
      if (ch.is_ext_shared) continue

      channels.push({
        id: ch.id!,
        name: ch.name!,
        isPrivate: ch.is_private || false,
      })
    }

    cursor = result.response_metadata?.next_cursor || undefined
  } while (cursor)

  channels.sort((a, b) => a.name.localeCompare(b.name))

  return channels
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
  } catch (error) {
    const slackError = error as { data?: { error?: string } }
    if (slackError.data?.error === 'method_not_supported_for_channel_type') {
      // Private channel -- bot must be invited manually
      console.warn(`[Slack] Cannot join private channel ${channelId} -- bot must be invited`)
      return false
    }
    if (slackError.data?.error === 'already_in_channel') {
      return true
    }
    throw error
  }
}
