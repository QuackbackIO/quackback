import type { IntegrationDefinition } from '../types'
import { asanaHook } from './hook'
import { asanaInboundHandler } from './inbound'
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
  inbound: asanaInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developers.asana.com/docs/oauth',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.asana.com/docs/oauth',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeAsanaToken(secrets.refreshToken as string, credentials),
}
