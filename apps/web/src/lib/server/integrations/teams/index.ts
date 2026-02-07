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
  requiredEnvVars: ['TEAMS_CLIENT_ID', 'TEAMS_CLIENT_SECRET'],
  async onDisconnect() {
    console.log('[Teams] Integration disconnected (no token revocation available)')
  },
}
