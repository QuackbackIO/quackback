import type { IntegrationDefinition } from '../types'
import { clickupHook } from './hook'
import { clickupInboundHandler } from './inbound'
import { getClickUpOAuthUrl, exchangeClickUpCode } from './oauth'
import { clickupCatalog } from './catalog'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'clickup' })

export const clickupIntegration: IntegrationDefinition = {
  id: 'clickup',
  catalog: clickupCatalog,
  oauth: {
    stateType: 'clickup_oauth',
    buildAuthUrl: getClickUpOAuthUrl,
    exchangeCode: exchangeClickUpCode,
  },
  hook: clickupHook,
  inbound: clickupInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://clickup.com/integrations',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://clickup.com/integrations',
    },
  ],
  async onDisconnect() {
    log.info('integration disconnected, no token revocation available')
  },
}
