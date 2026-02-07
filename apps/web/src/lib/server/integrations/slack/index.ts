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
  requiredEnvVars: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  onDisconnect: (secrets) => revokeSlackToken(secrets.accessToken as string),
}
