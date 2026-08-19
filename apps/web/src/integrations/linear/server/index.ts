import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { archiveLinearIssue } from '@/integrations/linear/server/archive'
import { fetchLinearStatuses } from '@/integrations/linear/server/statuses'
import {
  registerLinearWebhook,
  deleteLinearWebhook,
} from '@/integrations/linear/server/webhook-registration'
import { linearHook } from '@/integrations/linear/server/hook'
import { linearInboundHandler } from '@/integrations/linear/server/inbound'
import { linearIssues } from '@/integrations/linear/server/issues'
import {
  getLinearOAuthUrl,
  exchangeLinearCode,
  revokeLinearToken,
  refreshLinearToken,
} from '@/integrations/linear/server/oauth'
import { linearCatalog } from '@/integrations/linear/server/catalog'
import { listLinearTeams } from '@/integrations/linear/server/teams'

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  catalog: linearCatalog,
  oauth: {
    stateType: 'linear_oauth',
    buildAuthUrl: getLinearOAuthUrl,
    exchangeCode: exchangeLinearCode,
  },
  destinations: {
    team: {
      label: 'Team',
      list: async ({ accessToken }) => {
        const teams = await listLinearTeams(accessToken)
        return teams.map((t) => ({ id: t.id, name: t.name }))
      },
    },
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
  refreshToken: refreshLinearToken,
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
