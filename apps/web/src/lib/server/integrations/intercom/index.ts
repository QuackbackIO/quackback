import type { IntegrationDefinition } from '../types'
import { getIntercomOAuthUrl, exchangeIntercomCode } from './oauth'
import { intercomCatalog } from './catalog'
import { logger } from '@/lib/server/logger'
import { intercomContext } from './enrichment'

const log = logger.child({ component: 'intercom' })

export const intercomIntegration: IntegrationDefinition = {
  id: 'intercom',
  catalog: intercomCatalog,
  oauth: {
    stateType: 'intercom_oauth',
    buildAuthUrl: getIntercomOAuthUrl,
    exchangeCode: exchangeIntercomCode,
  },
  // No hook — Intercom is inbound (enrichment), not outbound (notifications)
  context: intercomContext,
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
    log.info('integration disconnected, no token revocation available')
  },
}
