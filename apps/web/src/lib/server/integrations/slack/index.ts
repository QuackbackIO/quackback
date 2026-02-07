import type { IntegrationDefinition } from '../types'
import { slackHook } from './hook'
import { getSlackOAuthUrl, exchangeSlackCode, revokeSlackToken } from './oauth'
import { slackCatalog } from './catalog'

export const slackIntegration: IntegrationDefinition = {
  id: 'slack',
  catalog: slackCatalog,
  oauth: {
    stateType: 'slack_oauth',
    buildAuthUrl: getSlackOAuthUrl,
    exchangeCode: exchangeSlackCode,
  },
  hook: slackHook,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://api.slack.com/apps',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://api.slack.com/apps',
    },
  ],
  onDisconnect: (secrets) => revokeSlackToken(secrets.accessToken as string),
}
