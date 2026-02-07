import type { IntegrationDefinition } from '../types'
import { jiraHook } from './hook'
import { getJiraOAuthUrl, exchangeJiraCode } from './oauth'
import { jiraCatalog } from './catalog'

export const jiraIntegration: IntegrationDefinition = {
  id: 'jira',
  catalog: jiraCatalog,
  oauth: {
    stateType: 'jira_oauth',
    buildAuthUrl: getJiraOAuthUrl,
    exchangeCode: exchangeJiraCode,
  },
  hook: jiraHook,
  requiredEnvVars: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
  async onDisconnect() {
    console.log('[Jira] Integration disconnected (no token revocation available)')
  },
}
