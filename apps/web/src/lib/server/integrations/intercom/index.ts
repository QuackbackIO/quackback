import type { IntegrationDefinition } from '../types'
import { getIntercomOAuthUrl, exchangeIntercomCode } from './oauth'
import { intercomCatalog } from './catalog'

export const intercomIntegration: IntegrationDefinition = {
  id: 'intercom',
  catalog: intercomCatalog,
  oauth: {
    stateType: 'intercom_oauth',
    buildAuthUrl: getIntercomOAuthUrl,
    exchangeCode: exchangeIntercomCode,
  },
  // No hook — Intercom is inbound (enrichment), not outbound (notifications)
  requiredEnvVars: ['INTERCOM_CLIENT_ID', 'INTERCOM_CLIENT_SECRET'],
  async onDisconnect() {
    console.log('[Intercom] Integration disconnected (no token revocation available)')
  },
}
