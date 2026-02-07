import type { IntegrationDefinition } from '../types'
import { asanaHook } from './hook'
import { getAsanaOAuthUrl, exchangeAsanaCode, revokeAsanaToken } from './oauth'
import { asanaCatalog } from './catalog'

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  catalog: asanaCatalog,
  oauth: {
    stateType: 'asana_oauth',
    buildAuthUrl: getAsanaOAuthUrl,
    exchangeCode: exchangeAsanaCode,
  },
  hook: asanaHook,
  requiredEnvVars: ['ASANA_CLIENT_ID', 'ASANA_CLIENT_SECRET'],
  onDisconnect: (secrets) => revokeAsanaToken(secrets.refreshToken as string),
}
