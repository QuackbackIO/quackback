import { slackAppHooks } from './hooks'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { slackHook } from '@/integrations/slack/server/hook'
import {
  getSlackOAuthUrl,
  exchangeSlackCode,
  revokeSlackToken,
} from '@/integrations/slack/server/oauth'
import { slackCatalog } from '@/integrations/slack/server/catalog'

export const slackIntegration: IntegrationDefinition = {
  id: 'slack',
  appHooks: slackAppHooks,
  install: {
    externalId: (c) => (typeof c.workspaceId === 'string' ? c.workspaceId : null),
    metadata: (c) => ({ bot_user_id: c.botUserId, enterprise_id: c.enterpriseId ?? null }),
  },
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
    {
      key: 'signingSecret',
      label: 'Signing Secret',
      sensitive: true,
      helpText: 'Found under Basic Information > App Credentials',
      helpUrl: 'https://api.slack.com/apps',
    },
  ],
  onDisconnect: (secrets) => revokeSlackToken(secrets.accessToken as string),
}
