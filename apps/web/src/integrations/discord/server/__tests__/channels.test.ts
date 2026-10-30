import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { listDiscordChannels, validateDiscordDestination } from '../channels'

const VIEW = 1n << 10n
const SEND = 1n << 11n
const EMBED = 1n << 14n
const ADMIN = 1n << 3n

const GUILD = 'guild-1'
const BOT = 'bot-user'
const BOT_ROLE = 'role-bot'
const OTHER_ROLE = 'role-other'
const TOKEN = 'test-bot-token'

interface Overwrite {
  id: string
  type: 0 | 1
  allow?: bigint
  deny?: bigint
}

function overwrite({ id, type, allow = 0n, deny = 0n }: Overwrite) {
  return { id, type, allow: allow.toString(), deny: deny.toString() }
}

function channel(
  id: string,
  name: string,
  position: number,
  overwrites: Overwrite[] = [],
  type = 0
) {
  return {
    id,
    name,
    type,
    position,
    guild_id: GUILD,
    permission_overwrites: overwrites.map(overwrite),
  }
}

interface FakeGuild {
  everyone: bigint
  roles: Record<string, bigint>
  botRoles: string[]
  channels: ReturnType<typeof channel>[]
  channelStatus?: Record<string, number>
}

let guild: FakeGuild
const requested: string[] = []

/** A Discord REST double that answers by path and rejects a missing or wrong bot token. */
function fakeDiscord(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
  const path = url.pathname.replace(/^\/api\/v10/, '')
  requested.push(path)
  const auth = new Headers(init?.headers).get('Authorization')
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  if (auth !== `Bot ${TOKEN}`) return json({ code: 0, message: '401: Unauthorized' }, 401)

  if (path === '/users/@me') return json({ id: BOT, bot: true })
  if (path === `/guilds/${GUILD}/roles`)
    return json([
      { id: GUILD, permissions: guild.everyone.toString() },
      ...Object.entries(guild.roles).map(([id, permissions]) => ({
        id,
        permissions: permissions.toString(),
      })),
    ])
  if (path === `/guilds/${GUILD}/members/${BOT}`) return json({ roles: guild.botRoles })
  if (path === `/guilds/${GUILD}/channels`) return json(guild.channels)
  const single = path.match(/^\/channels\/([^/]+)$/)
  if (single) {
    const status = guild.channelStatus?.[single[1]]
    if (status) return json({ code: 50001, message: 'Missing Access' }, status)
    const found = guild.channels.find((c) => c.id === single[1])
    return found ? json(found) : json({ code: 10003, message: 'Unknown Channel' }, 404)
  }
  return json({ code: 0, message: '404: Not Found' }, 404)
}

beforeEach(() => {
  requested.length = 0
  guild = {
    everyone: VIEW | SEND,
    roles: { [BOT_ROLE]: VIEW | SEND | EMBED, [OTHER_ROLE]: 0n },
    botRoles: [BOT_ROLE],
    channels: [],
  }
  vi.stubGlobal('fetch', vi.fn(fakeDiscord))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listDiscordChannels', () => {
  it('marks a private channel the bot was not given access to as unpostable', async () => {
    guild.channels = [
      channel('c-general', 'general', 0),
      channel('c-private', 'private-team', 1, [{ id: GUILD, type: 0, deny: VIEW }]),
    ]

    const channels = await listDiscordChannels(TOKEN, GUILD)

    expect(channels).toEqual([
      { id: 'c-general', name: 'general', isPrivate: false, canPost: true },
      { id: 'c-private', name: 'private-team', isPrivate: true, canPost: false },
    ])
  })

  it('allows a private channel when a role the bot holds is granted access', async () => {
    guild.channels = [
      channel('c-private', 'private-team', 0, [
        { id: GUILD, type: 0, deny: VIEW },
        { id: BOT_ROLE, type: 0, allow: VIEW | SEND },
      ]),
    ]

    expect(await listDiscordChannels(TOKEN, GUILD)).toEqual([
      { id: 'c-private', name: 'private-team', isPrivate: true, canPost: true },
    ])
  })

  it('ignores overwrites for roles the bot does not hold', async () => {
    guild.channels = [
      channel('c-private', 'private-team', 0, [
        { id: GUILD, type: 0, deny: VIEW },
        { id: OTHER_ROLE, type: 0, allow: VIEW | SEND },
      ]),
    ]

    expect((await listDiscordChannels(TOKEN, GUILD))[0]?.canPost).toBe(false)
  })

  it('lets a role allow win over another role deny, as Discord does', async () => {
    guild.botRoles = [BOT_ROLE, OTHER_ROLE]
    guild.channels = [
      channel('c-mixed', 'mixed', 0, [
        { id: OTHER_ROLE, type: 0, deny: SEND },
        { id: BOT_ROLE, type: 0, allow: SEND },
      ]),
    ]

    expect((await listDiscordChannels(TOKEN, GUILD))[0]?.canPost).toBe(true)
  })

  it('marks a read-only channel as unpostable even though the bot can see it', async () => {
    guild.channels = [
      channel('c-news', 'announcements', 0, [{ id: GUILD, type: 0, deny: SEND }], 5),
    ]

    expect(await listDiscordChannels(TOKEN, GUILD)).toEqual([
      { id: 'c-news', name: 'announcements', isPrivate: false, canPost: false },
    ])
  })

  it('applies a member overwrite for the bot after role overwrites', async () => {
    guild.channels = [
      channel('c-muted', 'muted', 0, [
        { id: BOT_ROLE, type: 0, allow: SEND },
        { id: BOT, type: 1, deny: SEND },
      ]),
    ]

    expect((await listDiscordChannels(TOKEN, GUILD))[0]?.canPost).toBe(false)
  })

  it('treats a bot with Administrator as able to post everywhere', async () => {
    guild.roles[BOT_ROLE] = ADMIN
    guild.channels = [channel('c-private', 'private-team', 0, [{ id: GUILD, type: 0, deny: VIEW }])]

    expect((await listDiscordChannels(TOKEN, GUILD))[0]?.canPost).toBe(true)
  })

  it('keeps only text and announcement channels, in Discord order', async () => {
    guild.channels = [
      channel('c-b', 'second', 2),
      channel('c-voice', 'voice', 1, [], 2),
      channel('c-a', 'first', 0),
    ]

    expect((await listDiscordChannels(TOKEN, GUILD)).map((c) => c.id)).toEqual(['c-a', 'c-b'])
  })

  it('reads the bot member of the requested guild', async () => {
    guild.channels = [channel('c-general', 'general', 0)]

    await listDiscordChannels(TOKEN, GUILD)

    expect(requested).toContain(`/guilds/${GUILD}/members/${BOT}`)
    expect(requested).toContain(`/guilds/${GUILD}/roles`)
  })
})

describe('validateDiscordDestination', () => {
  const config = { guildId: GUILD }

  it('accepts a text channel in the connected guild', async () => {
    guild.channels = [channel('c-general', 'general', 0)]

    await expect(
      validateDiscordDestination({ target: { channelId: 'c-general' }, config, accessToken: TOKEN })
    ).resolves.toBe(true)
  })

  it('rejects a channel the bot cannot see with a message the admin can act on', async () => {
    guild.channelStatus = { 'c-private': 403 }

    const result = validateDiscordDestination({
      target: { channelId: 'c-private' },
      config,
      accessToken: TOKEN,
    })

    await expect(result).rejects.toBeInstanceOf(ValidationError)
    await expect(result).rejects.toThrow(
      'Give the bot access to this channel in Discord, then try again.'
    )
  })

  it('returns false for a channel that does not exist', async () => {
    await expect(
      validateDiscordDestination({ target: { channelId: 'c-gone' }, config, accessToken: TOKEN })
    ).resolves.toBe(false)
  })
})
