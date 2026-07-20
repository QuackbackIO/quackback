import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import {
  getHubSpotOAuthUrl,
  exchangeHubSpotCode,
  revokeHubSpotToken,
  refreshHubSpotToken,
} from '@/integrations/hubspot/server/oauth'
import { hubspotCatalog } from '@/integrations/hubspot/server/catalog'
import { hubspotContext } from '@/integrations/hubspot/server/enrichment'

export const hubspotIntegration: IntegrationDefinition = {
  id: 'hubspot',
  catalog: hubspotCatalog,
  oauth: {
    stateType: 'hubspot_oauth',
    buildAuthUrl: getHubSpotOAuthUrl,
    exchangeCode: exchangeHubSpotCode,
  },
  // No hook — HubSpot is inbound (enrichment), not outbound (notifications)
  refreshToken: refreshHubSpotToken,
  context: hubspotContext,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developers.hubspot.com/',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.hubspot.com/',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeHubSpotToken(secrets.refreshToken as string, credentials),
}
