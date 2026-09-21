/**
 * Discord channel listing.
 */

import { integrationFetch } from '@/lib/server/integrations/sync/transport'

const DISCORD_API = 'https://discord.com/api/v10'

/** Bot credentials are shared across guilds; the selected installation is not. */
export async function validateDiscordDestination({
  target,
  config,
  accessToken,
}: {
  target: unknown
  config: Record<string, unknown>
  accessToken: string
}): Promise<boolean> {
  const channelId = (target as { channelId?: unknown } | null)?.channelId
  if (
    typeof channelId !== 'string' ||
    !channelId ||
    typeof config.guildId !== 'string' ||
    !config.guildId
  )
    return false
  const response = await integrationFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}`,
    {
      headers: { Authorization: `Bot ${accessToken}` },
    }
  )
  if (response.status === 404) return false
  if (!response.ok)
    throw Object.assign(new Error('Could not verify Discord channel'), { status: response.status })
  const channel = (await response.json()) as { guild_id?: string; type?: number }
  return channel.guild_id === config.guildId && TEXT_CHANNEL_TYPES.includes(channel.type ?? -1)
}

/** Discord channel types: 0 = text, 5 = announcement */
const TEXT_CHANNEL_TYPES = [0, 5]

interface DiscordChannel {
  id: string
  name: string
  type: number
  position: number
  parent_id?: string | null
}

/**
 * List text channels in a guild accessible to the bot.
 */
export async function listDiscordChannels(
  botToken: string,
  guildId: string
): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
  const response = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Discord channels: HTTP ${response.status}`)
  }

  const channels = (await response.json()) as DiscordChannel[]

  return channels
    .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: false,
    }))
}
