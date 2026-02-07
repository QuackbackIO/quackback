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
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://discord.com/developers/applications',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://discord.com/developers/applications',
    },
    {
      key: 'botToken',
      label: 'Bot Token',
      sensitive: true,
      helpUrl: 'https://discord.com/developers/applications',
    },
  ],
}
