/**
 * Discord channel listing.
 */

const DISCORD_API = 'https://discord.com/api/v10'

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
