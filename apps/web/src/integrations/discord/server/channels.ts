/**
 * Discord channel listing.
 */

import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { ValidationError } from '@/lib/shared/errors'

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
  // Discord answers 403 Missing Access for a channel hidden from the bot, typically a
  // private channel whose permissions were never extended to the bot's role.
  if (response.status === 403)
    throw new ValidationError(
      'DISCORD_CHANNEL_NO_ACCESS',
      'Give the bot access to this channel in Discord, then try again.'
    )
  if (!response.ok)
    throw Object.assign(new Error('Could not verify Discord channel'), { status: response.status })
  const channel = (await response.json()) as { guild_id?: string; type?: number }
  return channel.guild_id === config.guildId && TEXT_CHANNEL_TYPES.includes(channel.type ?? -1)
}

/** Discord channel types: 0 = text, 5 = announcement */
const TEXT_CHANNEL_TYPES = [0, 5]

const ADMINISTRATOR = 1n << 3n
const VIEW_CHANNEL = 1n << 10n
const SEND_MESSAGES = 1n << 11n
const EMBED_LINKS = 1n << 14n
/** Every notification is an embed, so a channel that denies Embed Links can't show it. */
const POST_PERMISSIONS = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS

interface PermissionOverwrite {
  id: string
  /** 0 = role, 1 = member */
  type: number
  allow: string
  deny: string
}

interface DiscordChannel {
  id: string
  name: string
  type: number
  position: number
  parent_id?: string | null
  permission_overwrites?: PermissionOverwrite[]
}

interface BotMember {
  userId: string
  roleIds: string[]
  /** Guild-level permissions: @everyone plus every role the bot holds. */
  base: bigint
}

async function discordGet<T>(path: string, botToken: string, what: string): Promise<T> {
  const response = await integrationFetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to load Discord ${what}: HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

async function getBotMember(botToken: string, guildId: string): Promise<BotMember> {
  const [user, roles] = await Promise.all([
    discordGet<{ id: string }>('/users/@me', botToken, 'bot user'),
    discordGet<Array<{ id: string; permissions: string }>>(
      `/guilds/${guildId}/roles`,
      botToken,
      'roles'
    ),
  ])
  const member = await discordGet<{ roles: string[] }>(
    `/guilds/${guildId}/members/${user.id}`,
    botToken,
    'bot member'
  )
  const rolePermissions = new Map(roles.map((r) => [r.id, BigInt(r.permissions)]))
  // The @everyone role shares the guild's id.
  let base = rolePermissions.get(guildId) ?? 0n
  for (const roleId of member.roles) base |= rolePermissions.get(roleId) ?? 0n
  return { userId: user.id, roleIds: member.roles, base }
}

/**
 * The bot's effective permissions in a channel, following Discord's documented order:
 * @everyone overwrite, then all role overwrites combined, then the member overwrite.
 */
function channelPermissions(bot: BotMember, guildId: string, channel: DiscordChannel): bigint {
  if (bot.base & ADMINISTRATOR) return bot.base | POST_PERMISSIONS
  const overwrites = channel.permission_overwrites ?? []
  const apply = (permissions: bigint, allow: bigint, deny: bigint) => (permissions & ~deny) | allow

  let permissions = bot.base
  const everyone = overwrites.find((o) => o.id === guildId)
  if (everyone) permissions = apply(permissions, BigInt(everyone.allow), BigInt(everyone.deny))

  let roleAllow = 0n
  let roleDeny = 0n
  for (const o of overwrites) {
    if (o.type === 0 && o.id !== guildId && bot.roleIds.includes(o.id)) {
      roleAllow |= BigInt(o.allow)
      roleDeny |= BigInt(o.deny)
    }
  }
  permissions = apply(permissions, roleAllow, roleDeny)

  const member = overwrites.find((o) => o.type === 1 && o.id === bot.userId)
  if (member) permissions = apply(permissions, BigInt(member.allow), BigInt(member.deny))
  return permissions
}

/**
 * List the guild's text channels. `canPost` is false where the bot cannot see the
 * channel, send to it, or embed in it, so the picker can steer admins away before saving.
 */
export async function listDiscordChannels(
  botToken: string,
  guildId: string
): Promise<Array<{ id: string; name: string; isPrivate: boolean; canPost: boolean }>> {
  const [channels, bot] = await Promise.all([
    discordGet<DiscordChannel[]>(`/guilds/${guildId}/channels`, botToken, 'channels'),
    getBotMember(botToken, guildId),
  ])

  return channels
    .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const everyone = c.permission_overwrites?.find((o) => o.id === guildId)
      return {
        id: c.id,
        name: c.name,
        isPrivate: !!everyone && (BigInt(everyone.deny) & VIEW_CHANNEL) !== 0n,
        canPost: (channelPermissions(bot, guildId, c) & POST_PERMISSIONS) === POST_PERMISSIONS,
      }
    })
}
