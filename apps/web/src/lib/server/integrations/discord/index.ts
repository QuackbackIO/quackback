import type { IntegrationDefinition } from '../types'
import { discordHook } from './hook'
import { getDiscordOAuthUrl, exchangeDiscordCode } from './oauth'
import { discordCatalog } from './catalog'

export const discordIntegration: IntegrationDefinition = {
  id: 'discord',
  catalog: discordCatalog,
  oauth: {
    stateType: 'discord_oauth',
    buildAuthUrl: getDiscordOAuthUrl,
    exchangeCode: exchangeDiscordCode,
  },
  hook: discordHook,
  requiredEnvVars: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN'],
}
