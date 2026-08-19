import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { getIntercomOAuthUrl, exchangeIntercomCode } from '@/integrations/intercom/server/oauth'
import { intercomCatalog } from '@/integrations/intercom/server/catalog'
import { logger } from '@/lib/server/logger'
import { intercomContext } from '@/integrations/intercom/server/enrichment'

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
