import type { IntegrationDefinition } from '../types'
import { linearHook } from './hook'
import { linearInboundHandler } from './inbound'
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
  inbound: linearInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://linear.app/settings/api',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://linear.app/settings/api',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeLinearToken(secrets.accessToken as string, credentials),
}
