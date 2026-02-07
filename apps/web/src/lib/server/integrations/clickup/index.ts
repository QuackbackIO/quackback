import type { IntegrationDefinition } from '../types'
import { clickupHook } from './hook'
import { getClickUpOAuthUrl, exchangeClickUpCode } from './oauth'
import { clickupCatalog } from './catalog'

export const clickupIntegration: IntegrationDefinition = {
  id: 'clickup',
  catalog: clickupCatalog,
  oauth: {
    stateType: 'clickup_oauth',
    buildAuthUrl: getClickUpOAuthUrl,
    exchangeCode: exchangeClickUpCode,
  },
  hook: clickupHook,
  requiredEnvVars: ['CLICKUP_CLIENT_ID', 'CLICKUP_CLIENT_SECRET'],
  async onDisconnect() {
    console.log('[ClickUp] Integration disconnected (no token revocation available)')
  },
}
