import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { discordHook } from '@/integrations/discord/server/hook'
import { getDiscordOAuthUrl, exchangeDiscordCode } from '@/integrations/discord/server/oauth'
import { discordCatalog } from '@/integrations/discord/server/catalog'

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
