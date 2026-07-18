import type { IntegrationDefinition } from '../types'
import { jiraHook } from './hook'
import { jiraInboundHandler } from './inbound'
import { jiraIssues } from './issues'
import { getJiraOAuthUrl, exchangeJiraCode } from './oauth'
import { jiraCatalog } from './catalog'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'jira' })

export const jiraIntegration: IntegrationDefinition = {
  id: 'jira',
  catalog: jiraCatalog,
  oauth: {
    stateType: 'jira_oauth',
    buildAuthUrl: getJiraOAuthUrl,
    exchangeCode: exchangeJiraCode,
  },
  hook: jiraHook,
  inbound: jiraInboundHandler,
  issues: jiraIssues,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developer.atlassian.com/console/myapps/',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developer.atlassian.com/console/myapps/',
    },
  ],
  async onDisconnect() {
    log.info('integration disconnected, no token revocation available')
  },
}
