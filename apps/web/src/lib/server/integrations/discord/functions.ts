/**
 * Discord-specific server functions.
 *
 * IMPORTANT: All server-only dependencies MUST use dynamic imports
 * inside handlers to avoid bundling Node.js-only code into the client.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface DiscordOAuthState {
  type: 'discord_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export interface DiscordChannel {
  id: string
  name: string
  isPrivate: boolean
}

interface DiscordIntegrationConfig {
  guildId?: string
  workspaceName?: string
}

/**
 * Generate a signed OAuth connect URL for Discord.
 */
export const getDiscordConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('discord'))) {
      throw new Error(
        'Discord platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'discord_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies DiscordOAuthState)

    return `/oauth/discord/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available Discord channels for the connected guild.
 */
export const fetchDiscordChannelsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DiscordChannel[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listDiscordChannels } = await import('./channels')

    console.log(`[fn:integrations] fetchDiscordChannelsFn`)
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'discord'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Discord not connected')
    }

    if (!integration.secrets) {
      throw new Error('Discord secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) {
      throw new Error('Discord bot token missing')
    }

    const cfg = (integration.config ?? {}) as DiscordIntegrationConfig
    if (!cfg.guildId) {
      throw new Error('Discord guild ID not found. Please reconnect Discord.')
    }

    const channels = await listDiscordChannels(secrets.accessToken, cfg.guildId)

    console.log(`[fn:integrations] fetchDiscordChannelsFn: ${channels.length} channels`)
    return channels
  }
)
