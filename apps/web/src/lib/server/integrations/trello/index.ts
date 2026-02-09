import type { IntegrationDefinition } from '../types'
import { trelloHook } from './hook'
import { getTrelloOAuthUrl, exchangeTrelloCode } from './oauth'
import { trelloCatalog } from './catalog'
import { trelloInboundHandler } from './inbound'

export const trelloIntegration: IntegrationDefinition = {
  id: 'trello',
  catalog: trelloCatalog,
  oauth: {
    stateType: 'trello_oauth',
    buildAuthUrl: getTrelloOAuthUrl,
    exchangeCode: exchangeTrelloCode,
  },
  hook: trelloHook,
  inbound: trelloInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'API Key',
      sensitive: false,
      helpUrl: 'https://trello.com/power-ups/admin',
    },
    {
      key: 'clientSecret',
      label: 'API Secret',
      sensitive: true,
      helpUrl: 'https://trello.com/power-ups/admin',
    },
  ],
}
