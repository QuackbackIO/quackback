/**
 * Discord OAuth utilities.
 * Handles OAuth2 bot authorization flow for adding the bot to a guild.
 */

import { config } from '@/lib/server/config'

const DISCORD_API = 'https://discord.com/api/v10'

/** Bot permission: Send Messages (2048) + Embed Links (16384) */
const BOT_PERMISSIONS = '18432'

/**
 * Generate the Discord OAuth authorization URL.
 * Uses the bot scope to add the bot to a guild.
 */
export function getDiscordOAuthUrl(state: string, redirectUri: string): string {
  const clientId = config.discordClientId
  if (!clientId) {
    throw new Error('DISCORD_CLIENT_ID environment variable not set')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    permissions: BOT_PERMISSIONS,
    scope: 'bot',
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  })

  return `https://discord.com/oauth2/authorize?${params}`
}

/**
 * Exchange an OAuth code for access tokens and guild info.
 */
export async function exchangeDiscordCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  config?: Record<string, unknown>
}> {
  const clientId = config.discordClientId
  const clientSecret = config.discordClientSecret
  const botToken = config.discordBotToken

  if (!clientId || !clientSecret) {
    throw new Error('DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set')
  }
  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN must be set')
  }

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Discord OAuth failed: ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    guild?: { id: string; name: string }
  }

  if (!data.guild) {
    throw new Error('Discord OAuth response missing guild data')
  }

  // Store the bot token as the access token for API calls
  return {
    accessToken: botToken,
    config: { guildId: data.guild.id, workspaceName: data.guild.name },
  }
}
