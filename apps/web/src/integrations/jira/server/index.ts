import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { closeJiraIssue } from '@/integrations/jira/server/archive'
import { fetchJiraStatuses } from '@/integrations/jira/server/statuses'
import {
  registerJiraWebhook,
  deleteJiraWebhook,
} from '@/integrations/jira/server/webhook-registration'
import { jiraHook } from '@/integrations/jira/server/hook'
import { jiraInboundHandler } from '@/integrations/jira/server/inbound'
import { jiraIssues } from '@/integrations/jira/server/issues'
import { listJiraProjects, listJiraIssueTypes } from '@/integrations/jira/server/projects'
import {
  getJiraOAuthUrl,
  exchangeJiraCode,
  refreshJiraToken,
} from '@/integrations/jira/server/oauth'
import { jiraCatalog } from '@/integrations/jira/server/catalog'
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
  archive: closeJiraIssue,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl, secret }) => {
      const cloudId = config.cloudId as string
      if (!cloudId) throw new Error('No Jira Cloud ID configured')
      const result = await registerJiraWebhook(accessToken, cloudId, callbackUrl, secret)
      return { externalWebhookId: result.webhookId }
    },
    unregister: async ({ accessToken, config, externalWebhookId }) => {
      const cloudId = config.cloudId as string
      if (cloudId) await deleteJiraWebhook(accessToken, cloudId, externalWebhookId)
    },
  },
  listExternalStatuses: fetchJiraStatuses,
  destinations: {
    project: {
      label: 'Project',
      list: async ({ accessToken, config }) => {
        const cloudId = config.cloudId as string
        const projects = await listJiraProjects(accessToken, cloudId)
        return projects.map((p) => ({ id: p.id, name: p.name }))
      },
    },
    'issue-type': {
      label: 'Issue type',
      childOf: 'project',
      list: async ({ accessToken, config, parentId }) => {
        if (!parentId) return []
        const cloudId = config.cloudId as string
        const issueTypes = await listJiraIssueTypes(accessToken, cloudId, parentId)
        return issueTypes.map((it) => ({ id: it.id, name: it.name }))
      },
    },
  },
  refreshToken: refreshJiraToken,
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
