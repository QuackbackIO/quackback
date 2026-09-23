import { channelDestination } from '@/lib/server/integrations/destination'
import { absolutizeMarkdownUrls } from '@/lib/server/integrations/post-content'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
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
  destination: channelDestination(['workspaceId', 'organizationId', 'teamId']),
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
  linkedItems: true,
  formatReviewContent: (content, rootUrl) => absolutizeMarkdownUrls(content, rootUrl, true),
  webhookRegistration: {
    register: async ({ accessToken, callbackUrl, secret }) => {
      const result = await registerLinearWebhook(accessToken, callbackUrl, secret)
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
