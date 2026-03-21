/**
 * Slack channel listing and membership.
 */

import { WebClient } from '@slack/web-api'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/redis'

type SlackChannelInfo = { id: string; name: string; isPrivate: boolean }

const CACHE_TTL_SECONDS = 300 // 5 minutes

/**
 * List all channels accessible to the bot.
 * Results are cached in Dragonfly for 5 minutes to avoid Slack API rate limits.
 * Pass `force: true` to bypass the cache (e.g. refresh button).
 */
export async function listSlackChannels(
  accessToken: string,
  opts?: { force?: boolean }
): Promise<SlackChannelInfo[]> {
  if (!opts?.force) {
    const cached = await cacheGet<SlackChannelInfo[]>(CACHE_KEYS.SLACK_CHANNELS)
    if (cached) {
      console.log('[Slack] Returning cached channel list')
      return cached
    }
  }

  const client = new WebClient(accessToken)
  const channels: SlackChannelInfo[] = []
  let cursor: string | undefined

  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
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

  await cacheSet(CACHE_KEYS.SLACK_CHANNELS, channels, CACHE_TTL_SECONDS)

  console.log(
    `[Slack] Fetched ${channels.length} channels from API (cached for ${CACHE_TTL_SECONDS}s)`
  )
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
