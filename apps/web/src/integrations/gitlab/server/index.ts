import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { closeGitLabIssue } from '@/integrations/gitlab/server/archive'
import { fetchGitLabStatuses } from '@/integrations/gitlab/server/statuses'
import { gitlabHook } from '@/integrations/gitlab/server/hook'
import { getGitLabOAuthUrl, exchangeGitLabCode } from '@/integrations/gitlab/server/oauth'
import { gitlabCatalog } from '@/integrations/gitlab/server/catalog'
import { gitlabInboundHandler } from '@/integrations/gitlab/server/inbound'
import { listGitLabProjects } from '@/integrations/gitlab/server/projects'

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
      list: async ({ accessToken }) => {
        const projects = await listGitLabProjects(accessToken)
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
      key: 'clientId',
      label: 'Application ID',
      sensitive: false,
      helpUrl: 'https://gitlab.com/-/user_settings/applications',
    },
    {
      key: 'clientSecret',
      label: 'Secret',
      sensitive: true,
      helpUrl: 'https://gitlab.com/-/user_settings/applications',
    },
  ],
}
