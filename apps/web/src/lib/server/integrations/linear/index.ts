import type { IntegrationDefinition } from '../types'
import { linearHook } from './hook'
import { getLinearOAuthUrl, exchangeLinearCode, revokeLinearToken } from './oauth'
import { linearCatalog } from './catalog'

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  catalog: linearCatalog,
  oauth: {
    stateType: 'linear_oauth',
    buildAuthUrl: getLinearOAuthUrl,
    exchangeCode: exchangeLinearCode,
  },
  hook: linearHook,
  requiredEnvVars: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
  onDisconnect: (secrets) => revokeLinearToken(secrets.accessToken as string),
}
