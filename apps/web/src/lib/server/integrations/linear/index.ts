import type { IntegrationDefinition } from '../types'
import { archiveLinearIssue } from './archive'
import { fetchLinearStatuses } from './statuses'
import { registerLinearWebhook, deleteLinearWebhook } from './webhook-registration'
import { linearHook } from './hook'
import { linearInboundHandler } from './inbound'
import { linearIssues } from './issues'
import { getLinearOAuthUrl, exchangeLinearCode, revokeLinearToken } from './oauth'
import { linearCatalog } from './catalog'

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  catalog: linearCatalog,
  oauth: {
    stateType: 'linear_oauth',
    buildAuthUrl: getLinearOAuthUrl,
    exchangeCode: exchangeLinearCode,
  },
  hook: linearHook,
  inbound: linearInboundHandler,
  issues: linearIssues,
  archive: archiveLinearIssue,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl, secret }) => {
      const teamId = config.channelId as string | undefined
      const result = await registerLinearWebhook(accessToken, callbackUrl, secret, teamId)
      return { externalWebhookId: result.webhookId }
    },
    unregister: async ({ accessToken, externalWebhookId }) =>
      deleteLinearWebhook(accessToken, externalWebhookId),
  },
  listExternalStatuses: fetchLinearStatuses,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://linear.app/settings/api',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://linear.app/settings/api',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeLinearToken(secrets.accessToken as string, credentials),
}
