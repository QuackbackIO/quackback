import type { IntegrationDefinition } from '../types'
import { teamsHook } from './hook'
import { getTeamsOAuthUrl, exchangeTeamsCode } from './oauth'
import { teamsCatalog } from './catalog'

export const teamsIntegration: IntegrationDefinition = {
  id: 'teams',
  catalog: teamsCatalog,
  oauth: {
    stateType: 'teams_oauth',
    buildAuthUrl: getTeamsOAuthUrl,
    exchangeCode: exchangeTeamsCode,
  },
  hook: teamsHook,
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
    console.log('[Teams] Integration disconnected (no token revocation available)')
  },
}
