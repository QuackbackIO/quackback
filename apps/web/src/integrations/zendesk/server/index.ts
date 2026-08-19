import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import {
  getZendeskOAuthUrl,
  exchangeZendeskCode,
  revokeZendeskToken,
} from '@/integrations/zendesk/server/oauth'
import { zendeskCatalog } from '@/integrations/zendesk/server/catalog'
import { zendeskContext } from '@/integrations/zendesk/server/enrichment'

export const zendeskIntegration: IntegrationDefinition = {
  id: 'zendesk',
  catalog: zendeskCatalog,
  oauth: {
    stateType: 'zendesk_oauth',
    preAuthFields: [
      {
        name: 'subdomain',
        label: 'Zendesk Subdomain',
        placeholder: 'your-company',
        pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
        patternError: 'Subdomain must be lowercase alphanumeric with hyphens (e.g. your-company)',
        required: true,
      },
    ],
    buildAuthUrl: getZendeskOAuthUrl,
    exchangeCode: exchangeZendeskCode,
  },
  // No hook — Zendesk is inbound (enrichment), not outbound (notifications)
  context: zendeskContext,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developer.zendesk.com/',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developer.zendesk.com/',
    },
  ],
  async onDisconnect(secrets, config) {
    await revokeZendeskToken(secrets.accessToken as string, config.subdomain as string)
  },
}
