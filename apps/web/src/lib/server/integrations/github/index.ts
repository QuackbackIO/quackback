import type { IntegrationDefinition } from '../types'
import { closeGitHubIssue } from './archive'
import { fetchGitHubStatuses } from './statuses'
import { registerGitHubWebhook, deleteGitHubWebhook } from './webhook-registration'
import { githubHook } from './hook'
import { githubInboundHandler } from './inbound'
import { githubIssues } from './issues'
import { getGitHubOAuthUrl, exchangeGitHubCode, revokeGitHubToken } from './oauth'
import { githubCatalog } from './catalog'

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  catalog: githubCatalog,
  oauth: {
    stateType: 'github_oauth',
    buildAuthUrl: getGitHubOAuthUrl,
    exchangeCode: exchangeGitHubCode,
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
