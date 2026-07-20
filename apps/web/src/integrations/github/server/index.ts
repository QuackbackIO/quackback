import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { closeGitHubIssue } from '@/integrations/github/server/archive'
import { fetchGitHubStatuses } from '@/integrations/github/server/statuses'
import {
  registerGitHubWebhook,
  deleteGitHubWebhook,
} from '@/integrations/github/server/webhook-registration'
import { githubHook } from '@/integrations/github/server/hook'
import { githubInboundHandler } from '@/integrations/github/server/inbound'
import { githubIssues } from '@/integrations/github/server/issues'
import {
  getGitHubOAuthUrl,
  exchangeGitHubCode,
  revokeGitHubToken,
} from '@/integrations/github/server/oauth'
import { githubCatalog } from '@/integrations/github/server/catalog'
import { listGitHubRepos } from '@/integrations/github/server/repos'

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  catalog: githubCatalog,
  oauth: {
    stateType: 'github_oauth',
    buildAuthUrl: getGitHubOAuthUrl,
    exchangeCode: exchangeGitHubCode,
  },
  destinations: {
    repo: {
      label: 'Repository',
      list: async ({ accessToken }) => {
        const repos = await listGitHubRepos(accessToken)
        return repos.map((r) => ({ id: r.fullName, name: r.fullName }))
      },
    },
  },
  hook: githubHook,
  inbound: githubInboundHandler,
  issues: githubIssues,
  archive: closeGitHubIssue,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl, secret }) => {
      const ownerRepo = config.channelId as string
      if (!ownerRepo) throw new Error('No repository configured')
      const result = await registerGitHubWebhook(accessToken, ownerRepo, callbackUrl, secret)
      return { externalWebhookId: result.webhookId }
    },
    unregister: async ({ accessToken, config, externalWebhookId }) => {
      const ownerRepo = config.channelId as string
      if (ownerRepo) await deleteGitHubWebhook(accessToken, ownerRepo, externalWebhookId)
    },
  },
  listExternalStatuses: fetchGitHubStatuses,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://github.com/settings/developers',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://github.com/settings/developers',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeGitHubToken(secrets.accessToken as string, credentials),
}
