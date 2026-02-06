import type { IntegrationDefinition } from '../types'
import { slackHook } from './hook'
import { saveIntegration } from './save'
import { getSlackOAuthUrl, exchangeSlackCode, revokeSlackToken } from './oauth'

export const slackIntegration: IntegrationDefinition = {
  id: 'slack',
  catalog: {
    id: 'slack',
    name: 'Slack',
    description: 'Get notified in Slack when users submit feedback or when statuses change.',
    iconBg: 'bg-[#4A154B]',
    settingsPath: '/admin/settings/integrations/slack',
    available: true,
  },
  oauth: {
    stateType: 'slack_oauth',
    errorParam: 'error',
    buildAuthUrl: getSlackOAuthUrl,
    exchangeCode: exchangeSlackCode,
  },
  hook: slackHook,
  requiredEnvVars: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  saveConnection: saveIntegration,
  onDisconnect: (secrets) => revokeSlackToken(secrets.accessToken as string),
}
