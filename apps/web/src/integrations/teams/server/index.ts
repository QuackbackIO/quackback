import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { teamsHook } from '@/integrations/teams/server/hook'
import {
  getTeamsOAuthUrl,
  exchangeTeamsCode,
  refreshTeamsToken,
} from '@/integrations/teams/server/oauth'
import { teamsCatalog } from '@/integrations/teams/server/catalog'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'teams' })

export const teamsIntegration: IntegrationDefinition = {
  id: 'teams',
  catalog: teamsCatalog,
  oauth: {
    stateType: 'teams_oauth',
    buildAuthUrl: getTeamsOAuthUrl,
    exchangeCode: exchangeTeamsCode,
  },
  hook: teamsHook,
  refreshToken: refreshTeamsToken,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    },
  ],
  async onDisconnect() {
    log.info('integration disconnected, no token revocation available')
  },
}
