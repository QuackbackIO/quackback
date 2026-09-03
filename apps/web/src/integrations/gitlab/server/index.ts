import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { closeGitLabIssue } from '@/integrations/gitlab/server/archive'
import { fetchGitLabStatuses } from '@/integrations/gitlab/server/statuses'
import { gitlabHook } from '@/integrations/gitlab/server/hook'
import { getGitLabOAuthUrl, exchangeGitLabCode } from '@/integrations/gitlab/server/oauth'
import { gitlabCatalog } from '@/integrations/gitlab/server/catalog'
import { gitlabInboundHandler } from '@/integrations/gitlab/server/inbound'
import { listGitLabProjects } from '@/integrations/gitlab/server/projects'

const GITLAB_APP_DOCS = 'https://docs.gitlab.com/integration/oauth_provider.html'

export const gitlabIntegration: IntegrationDefinition = {
  id: 'gitlab',
  catalog: gitlabCatalog,
  oauth: {
    stateType: 'gitlab_oauth',
    buildAuthUrl: getGitLabOAuthUrl,
    exchangeCode: exchangeGitLabCode,
  },
  destinations: {
    project: {
      label: 'Project',
      list: async ({ accessToken, config }) => {
        const projects = await listGitLabProjects(
          accessToken,
          config.instanceUrl as string | undefined
        )
        return projects.map((p) => ({ id: String(p.id), name: p.name }))
      },
    },
  },
  hook: gitlabHook,
  inbound: gitlabInboundHandler,
  archive: closeGitLabIssue,
  webhookRegistration: 'manual',
  listExternalStatuses: fetchGitLabStatuses,
  platformCredentials: [
    {
      key: 'instanceUrl',
      label: 'GitLab instance URL',
      placeholder: 'https://gitlab.com',
      sensitive: false,
      required: false,
      url: true,
      helpText:
        'Leave blank to use GitLab.com. For a self-hosted instance, enter the base URL (https://gitlab.example.com).',
    },
    {
      key: 'clientId',
      label: 'Application ID',
      sensitive: false,
      helpUrl: GITLAB_APP_DOCS,
      helpText:
        'Create an OAuth application on your GitLab instance and register the redirect URI shown above.',
    },
    {
      key: 'clientSecret',
      label: 'Secret',
      sensitive: true,
      helpUrl: GITLAB_APP_DOCS,
    },
  ],
}
