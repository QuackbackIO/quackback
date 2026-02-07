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
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developers.intercom.com/',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.intercom.com/',
    },
  ],
  async onDisconnect() {
    console.log('[Intercom] Integration disconnected (no token revocation available)')
  },
}
